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

export function callGemini(options: {
  apiKey: string
  model: string
  method: 'generateContent' | 'streamGenerateContent'
  body: unknown
  signal?: AbortSignal
}): Promise<Response> {
  const query = options.method === 'streamGenerateContent' ? '?alt=sse' : ''
  return fetch(`${GEMINI_ENDPOINT}/${options.model}:${options.method}${query}`, {
    method: 'POST',
    signal: options.signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
    body: JSON.stringify(options.body)
  })
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
