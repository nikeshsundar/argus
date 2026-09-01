import { TALK_SYSTEM_PROMPT } from './prompt'
import { ProviderUnavailableError, type VisionProvider, type VisionRequest } from './types'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Not every key/model combination exposes `streamGenerateContent` - some tiers
 * only offer `generateContent`. Remember which one worked so we pay the failed
 * streaming request at most once per model.
 */
const streamingSupport = new Map<string, boolean>()

interface GeminiPart {
  text?: string
  thought?: boolean
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
  error?: { message?: string }
}

export function createGeminiProvider(options: { apiKey: string; model: string }): VisionProvider {
  const { apiKey, model } = options

  if (!apiKey) {
    throw new ProviderUnavailableError('No Gemini API key set. Type "/key <your-key>" here.')
  }

  const post = (method: string, body: string, signal?: AbortSignal): Promise<Response> =>
    fetch(`${ENDPOINT}/${model}:${method}${method.startsWith('stream') ? '?alt=sse' : ''}`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body
    })

  return {
    name: 'gemini',

    async ask({ prompt, image, onDelta, signal }: VisionRequest): Promise<string> {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: TALK_SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: 'image/png', data: image.toString('base64') } },
              { text: prompt }
            ]
          }
        ],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.2 }
      })

      if (streamingSupport.get(model) !== false) {
        const response = await post('streamGenerateContent', body, signal)

        if (response.ok && response.body) {
          streamingSupport.set(model, true)
          return await consumeStream(response.body, onDelta)
        }

        // A 404 here means this model has no streaming method - fall through
        // and try the plain one. Anything else is a real failure.
        if (response.status !== 404) throw new Error(await describeFailure(response, model))
        streamingSupport.set(model, false)
      }

      const response = await post('generateContent', body, signal)
      if (!response.ok) throw new Error(await describeFailure(response, model))

      const text = extractText((await response.json()) as GeminiResponse)
      if (text) onDelta(text)
      return text
    }
  }
}

function extractText(payload: GeminiResponse): string {
  if (payload.error?.message) throw new Error(`Gemini: ${payload.error.message}`)
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && part.text) // reasoning parts stay internal
    .map((part) => part.text)
    .join('')
    .trim()
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void
): Promise<string> {
  let answer = ''
  for await (const event of readServerSentEvents(body)) {
    const text = extractText(JSON.parse(event) as GeminiResponse)
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

async function describeFailure(response: Response, model: string): Promise<string> {
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
