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

export async function callGemini(options: {
  apiKey: string
  model: string
  method: 'generateContent' | 'streamGenerateContent'
  body: unknown
  signal?: AbortSignal
  thinking?: ThinkingLevel
}): Promise<Response> {
  const query = options.method === 'streamGenerateContent' ? '?alt=sse' : ''
  const url = `${GEMINI_ENDPOINT}/${options.model}:${options.method}${query}`

  const post = (body: unknown, key: string): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      signal: options.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body)
    })

  const wantsThinking = Boolean(options.thinking) && thinkingSupport.get(options.model) !== false
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
        thinkingSupport.set(options.model, false)
        return await post(options.body, key)
      }
    }

    if (response.ok && wantsThinking) thinkingSupport.set(options.model, true)

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
  if (response.status === 503) {
    return `Gemini says "${model}" is overloaded right now. Try again, or switch with "/model <model-id>".`
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
