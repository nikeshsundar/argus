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

  const post = (body: unknown): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      signal: options.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
      body: JSON.stringify(body)
    })

  if (!options.thinking) return await post(options.body)

  const response = await post(withThinking(options.body, options.thinking))
  if (response.status !== 400) return response

  // thinkingConfig is not understood by every model. It is a speed hint, so a
  // model that rejects it should still run the task - just slower.
  let detail = ''
  try {
    detail = ((await response.clone().json()) as GeminiResponse).error?.message ?? ''
  } catch {
    // Unreadable body; fall through and return the original failure.
  }

  return /thinking/i.test(detail) ? await post(options.body) : response
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

  if (response.status === 400 && /api key/i.test(detail)) {
    return 'That Gemini API key was rejected. Set a new one with "/key <your-key>".'
  }
  if (response.status === 404) {
    return `Gemini has no model "${model}" available to this key. Switch with "/model <model-id>".`
  }
  if (response.status === 429) {
    return 'Gemini rate limit hit (free tier is limited) - try again in a moment.'
  }
  if (response.status === 503) {
    return `Gemini says "${model}" is overloaded right now. Try again, or switch with "/model <model-id>".`
  }
  return `Gemini API error ${response.status}${detail ? `: ${detail}` : ''}`
}
