import { hasReadyKey, poolSize, restAfterRefusal, secondsUntilReady, takeKey } from '../geminiKeys'

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GeminiPart {
  text?: string
  thought?: boolean
  functionCall?: { name: string; args: Record<string, unknown> }
}

export interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
  error?: { message?: string }
}

/**
 * How hard the model should think before answering.
 *
 * Left unset for Talk Mode, where the answer is the product. Agent and Teach
 * steps are the opposite: "which control do I point at next" is perception, and
 * deliberating over it costs seconds per step on a task that takes a dozen.
 */
export type ThinkingLevel = 'low' | 'high'

/**
 * Models known to reject `thinkingConfig`, so the hint is offered once.
 *
 * Without this the retry below fires on every single call: Agent Mode makes a
 * dozen of them per task, so a model that does not understand the hint was
 * costing two HTTP round trips and two of a twenty-a-day quota for every step,
 * and thinking at full depth anyway. The streaming path has always remembered
 * its own failure this way; this one had been left to relearn it forever.
 */
const thinkingSupport = new Map<string, boolean>()

/** Merges a thinking hint into the request without disturbing the rest of it. */
function withThinking(body: unknown, level: ThinkingLevel): unknown {
  const request = body as { generationConfig?: Record<string, unknown> }
  return {
    ...(request as object),
    generationConfig: {
      ...(request.generationConfig ?? {}),
      thinkingConfig: { thinkingLevel: level }
    }
  }
}

/**
 * A 503 from Gemini means "busy, come back" - it is the one status where
 * trying again is the correct response rather than a hopeful one. Two extra
 * attempts, backing off, because the alternative is handing the user an error
 * for something that would have worked a second later.
 */
const OVERLOAD_RETRIES = 2
const OVERLOAD_BACKOFF_MS = [700, 1600]

/**
 * How long a model that answered 503 is left alone.
 *
 * Without this the retries become the problem they were meant to solve. While
 * a model is down, every request pays three failed round trips and 2.3
 * seconds of backoff before falling back - on every transcription, every agent
 * step. Learning it once and going straight to the model that works is the
 * difference between a slow feature and a broken one.
 *
 * A minute, because being overloaded is a passing state and this must not
 * strand someone on a slower model after Google recovers.
 */
const OVERLOAD_COOLDOWN_MS = 60_000

/**
 * How long to wait for a model to START answering.
 *
 * There was no limit at all, which is worse than a slow answer: a model that
 * hangs holds the whole task until the user presses Escape, and two were
 * measured hanging past 20 seconds with nothing at all.
 *
 * This is a deadline on the response arriving, not on the answer finishing -
 * the timer is cleared the moment headers come back, so a long reply is never
 * cut off halfway.
 *
 * Generous, because headers do not come back until the request has finished
 * uploading. A voice clip is most of a megabyte of audio; ten seconds looked
 * ample against a "hi" and then timed out every model in the chain on a real
 * transcription, turning a working fallback into a slower way to fail.
 */
const REQUEST_TIMEOUT_MS = 25_000

/**
 * Agent and Teach steps send one small screenshot and ask one small question,
 * a dozen times a task. Waiting 25 seconds on each of those is its own
 * failure, so they set their own, shorter deadline.
 */
export const STEP_TIMEOUT_MS = 12_000

/** When each model is worth trying again. Keyed by model id. */
const restingUntil = new Map<string, number>()

/**
 * Puts models that are known to be up ahead of ones that just refused.
 *
 * If every candidate is resting the original order is kept: something has to
 * be tried, and a stale cooldown is a worse reason to fail than a real 503.
 */
export function preferAvailable(
  candidates: string[],
  resting: Map<string, number>,
  now: number
): string[] {
  const ready = candidates.filter((model) => (resting.get(model) ?? 0) <= now)
  if (ready.length > 0) return ready

  // Everything is resting, so Google is having a bad minute and none of these
  // is going to answer. Walking the whole chain again would spend the deadline
  // once per model to reach the same conclusion - a minute of waiting to be
  // told what the first ten seconds already established. Try the one closest
  // to being worth another go, and report quickly.
  const soonest = [...candidates].sort(
    (a, b) => (resting.get(a) ?? 0) - (resting.get(b) ?? 0)
  )
  return soonest.slice(0, 1)
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

export async function callGemini(options: {
  apiKey: string
  model: string
  method: 'generateContent' | 'streamGenerateContent'
  body: unknown
  signal?: AbortSignal
  thinking?: ThinkingLevel
  /**
   * Models to try when the chosen one is overloaded, in order.
   *
   * Only for models the user did not choose - the fast one behind Agent, Teach
   * and voice. Retrying does not help when a model is refusing everyone, and
   * failing the task while another model on the same key would have answered
   * is a worse outcome than a slower answer. Talk Mode deliberately passes
   * nothing here: someone who picked a model with "/aimodel" should not get a
   * silent substitute answering in its place.
   *
   * Free-tier quota is counted per model, so this also buys a second
   * allowance on the day the first runs out.
   */
  fallbackModels?: string[]
  /** Told which model answered - so a substitution can be admitted, not hidden. */
  onModelChosen?: (model: string) => void
  /** Overrides the default deadline. Small, frequent calls should ask for less. */
  timeoutMs?: number
}): Promise<Response> {
  const candidates = preferAvailable(
    modelCandidates(options.model, options.fallbackModels),
    restingUntil,
    Date.now()
  )

  let response = await attempt(candidates[0]!, { ...options, hasAlternatives: candidates.length > 1 })
  noteAvailability(candidates[0]!, response.status)
  if (response.ok) options.onModelChosen?.(candidates[0]!)

  for (let next = 1; response.status === 503 && next < candidates.length; next++) {
    if (options.signal?.aborted) return response
    response = await attempt(candidates[next]!, {
      ...options,
      hasAlternatives: next < candidates.length - 1
    })
    noteAvailability(candidates[next]!, response.status)
    if (response.ok) options.onModelChosen?.(candidates[next]!)
  }
  return response
}

/** Remembers which models are refusing, so the next call skips them. */
function noteAvailability(model: string, status: number): void {
  if (status === 503) restingUntil.set(model, Date.now() + OVERLOAD_COOLDOWN_MS)
  else restingUntil.delete(model)
}

/**
 * The models to try, in order, first choice first.
 *
 * Blanks and repeats are dropped: settings can legitimately hold the same id
 * for the quick model and the Talk model, and trying it twice would double the
 * wait before reporting a failure that was already decided.
 */
export function modelCandidates(model: string, fallbacks: string[] = []): string[] {
  const seen: string[] = []
  for (const name of [model, ...fallbacks]) {
    if (name && !seen.includes(name)) seen.push(name)
  }
  return seen
}

async function attempt(
  model: string,
  options: {
    apiKey: string
    method: 'generateContent' | 'streamGenerateContent'
    body: unknown
    signal?: AbortSignal
    thinking?: ThinkingLevel
    /** True when another model is queued behind this one. */
    hasAlternatives?: boolean
    timeoutMs?: number
  }
): Promise<Response> {
  const query = options.method === 'streamGenerateContent' ? '?alt=sse' : ''
  const url = `${GEMINI_ENDPOINT}/${model}:${options.method}${query}`

  const send = async (body: unknown, key: string): Promise<Response> => {
    // The caller's cancellation and our own deadline both have to reach fetch,
    // and only one of them means the user changed their mind.
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS)
    const signal = options.signal
      ? AbortSignal.any([options.signal, deadline.signal])
      : deadline.signal

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body)
      })
      // Headers are back, so the model is alive. Everything after this is it
      // writing the answer, which is allowed to take as long as it takes -
      // leaving the timer armed would cut a long reply off mid-sentence.
      clearTimeout(timer)
      return response
    } catch (error) {
      // A user pressing Escape is a real abort and must propagate.
      if (options.signal?.aborted) throw error
      if (!deadline.signal.aborted) throw error

      // Our own deadline. A model that will not answer is unavailable, which
      // is what 503 means - so it takes the same path and the next model in
      // the chain gets a turn.
      return new Response(null, { status: 503, headers: { 'x-argus-timeout': '1' } })
    } finally {
      clearTimeout(timer)
    }
  }

  // Retries only the "server is busy" case. A refused key, a bad model or a
  // spent quota are all answers, and asking again does not change them.
  //
  // And only when this is the last resort. With other models to try, asking a
  // busy one three times is three waits before reaching the one that would
  // have answered immediately - the cooldown will keep this model out of the
  // way afterwards either way.
  const retries = options.hasAlternatives ? 0 : OVERLOAD_RETRIES
  const post = async (body: unknown, key: string): Promise<Response> => {
    let response = await send(body, key)
    for (let retry = 0; response.status === 503 && retry < retries; retry++) {
      if (options.signal?.aborted) return response
      await pause(OVERLOAD_BACKOFF_MS[retry] ?? 1600, options.signal)
      if (options.signal?.aborted) return response
      response = await send(body, key)
    }
    return response
  }

  const wantsThinking = Boolean(options.thinking) && thinkingSupport.get(model) !== false
  const body = wantsThinking ? withThinking(options.body, options.thinking!) : options.body

  // One attempt per key. A refused key is rested and the next one picked up,
  // so a quota that runs out mid-task does not end the task.
  for (let attempt = 0; attempt < Math.max(1, poolSize()); attempt++) {
    const key = takeKey() ?? options.apiKey
    const response = await post(body, key)

    // 429 is a quota window that reopens; 401/403 is a key that never will.
    // Either way another key may work, and one bad key in the pool must not
    // fail a request that a good one could have served.
    if (response.status === 429 || response.status === 401 || response.status === 403) {
      const detail = await peek(response)
      restAfterRefusal(key, detail, response.status)
      if (hasReadyKey()) continue
      return response
    }

    // thinkingConfig is not understood by every model. It is a speed hint, so
    // a model that rejects it should still run the task - just slower. Noted,
    // so this costs one wasted request per model rather than one per step.
    if (response.status === 400 && wantsThinking) {
      const detail = await peek(response)
      if (/thinking/i.test(detail)) {
        thinkingSupport.set(model, false)
        return await post(options.body, key)
      }
    }

    if (response.ok && wantsThinking) thinkingSupport.set(model, true)

    return response
  }

  return await post(body, options.apiKey)
}

/** Reads an error body without consuming the response the caller may still need. */
async function peek(response: Response): Promise<string> {
  try {
    return JSON.stringify((await response.clone().json()) as GeminiResponse)
  } catch {
    return ''
  }
}

/** Seconds until any key is usable again - for the message shown on failure. */
export function retryAdviceSeconds(): number {
  return secondsUntilReady()
}

/**
 * Strips screenshots from every turn but the newest.
 *
 * The history was accumulating one full screenshot per step, so step 10 re-sent
 * ten of them - roughly 1,100 prompt tokens each, growing the request every
 * turn and eating a free-tier rate limit that is counted per request AND per
 * token. Only the current screen matters for the next decision; what happened
 * before it is already in the function-call history as text.
 */
export function dropStaleImages(contents: { role: string; parts: unknown[] }[]): void {
  for (let index = 0; index < contents.length - 1; index++) {
    const turn = contents[index]
    if (!turn) continue
    turn.parts = turn.parts.map((part) =>
      part && typeof part === 'object' && 'inline_data' in part
        ? { text: '[earlier screenshot omitted - see the current one]' }
        : part
    )
  }
}

export async function describeGeminiFailure(response: Response, model: string): Promise<string> {
  let detail = ''
  try {
    detail = ((await response.json()) as GeminiResponse).error?.message ?? ''
  } catch {
    // Non-JSON error body - the status alone will have to do.
  }

  if ((response.status === 400 && /api key/i.test(detail)) || response.status === 401) {
    return 'Every Gemini key was rejected. Check them with "/keys", then add a working one with "/key <your-key>".'
  }
  if (response.status === 404) {
    return `Gemini has no model "${model}" available to this key. Switch with "/model <model-id>".`
  }
  if (response.status === 429) {
    const wait = retryAdviceSeconds()
    const when = wait > 90 ? `about ${Math.round(wait / 60)} min` : `${wait || 30}s`
    return `Every Gemini key is over quota (the free tier allows 20 requests a day per model). Try again in ${when}, or add another key with "/key <your-key>".`
  }
  if (response.headers.get('x-argus-timeout')) {
    return (
      `"${model}" stopped responding — every model I tried was either overloaded or silent. ` +
      'A busy model is at Google end, not yours. Try again in a minute, or pick another with "/aimodel".'
    )
  }
  if (response.status === 503) {
    // Already retried three times by the time this is written, so "try again"
    // on its own would be poor advice - name the way out as well. Talk and the
    // Agent/Teach/voice model are set by different commands, and pointing at
    // the wrong one is how someone changes a setting that was never involved.
    return (
      `Gemini says "${model}" is overloaded — I tried ${OVERLOAD_RETRIES + 1} times. ` +
      'Give it a minute, or switch model: "/aimodel" for Talk, "/model agent <id>" for Agent, Teach and voice.'
    )
  }
  return `Gemini API error ${response.status}${detail ? `: ${detail}` : ''}`
}

/**
 * Pulls the answer out of one Gemini payload.
 *
 * Shared by every text-producing caller here, so a reasoning part leaking into
 * a visible answer is a bug that can only exist in one place.
 */
export function extractText(payload: unknown): string {
  const response = payload as GeminiResponse
  if (response.error?.message) throw new Error(`Gemini: ${response.error.message}`)
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && part.text) // reasoning parts stay internal
    .map((part) => part.text)
    .join('')
    .trim()
}

/** Reads a streamed answer, reporting each chunk as it lands. */
export async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void
): Promise<string> {
  let answer = ''
  for await (const event of readServerSentEvents(body)) {
    const text = extractText(JSON.parse(event))
    if (!text) continue
    answer += text
    onDelta(text)
  }
  return answer.trim()
}

/** Yields the JSON payload of each `data:` event in an SSE stream. */
async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    // Gemini separates events with CRLF pairs; dropping CR lets one
    // delimiter check cover both CRLF and LF streams.
    buffer += decoder.decode(bytes, { stream: true }).replace(/\r/g, '')

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')

      for (const line of event.split('\n')) {
        if (line.startsWith('data:')) yield line.slice(5).trim()
      }
    }
  }
}
