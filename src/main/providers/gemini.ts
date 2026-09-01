import { TALK_SYSTEM_PROMPT } from './prompt'
import { ProviderUnavailableError, type VisionProvider, type VisionRequest } from './types'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GeminiPart {
  text?: string
  thought?: boolean
}

interface GeminiChunk {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
  error?: { message?: string }
}

export function createGeminiProvider(options: { apiKey: string; model: string }): VisionProvider {
  if (!options.apiKey) {
    throw new ProviderUnavailableError('No Gemini API key set. Type "/key <your-key>" here.')
  }

  return {
    name: 'gemini',

    async ask({ prompt, image, onDelta, signal }: VisionRequest): Promise<string> {
      const response = await fetch(
        `${ENDPOINT}/${options.model}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': options.apiKey
          },
          body: JSON.stringify({
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
        }
      )

      if (!response.ok || !response.body) {
        throw new Error(await describeFailure(response, options.model))
      }

      let answer = ''
      for await (const chunk of readServerSentEvents(response.body)) {
        const parsed = JSON.parse(chunk) as GeminiChunk
        if (parsed.error?.message) throw new Error(`Gemini: ${parsed.error.message}`)

        for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
          // Reasoning parts are internal - don't render them in the bar.
          if (part.thought || !part.text) continue
          answer += part.text
          onDelta(part.text)
        }
      }

      return answer.trim()
    }
  }
}

/** Yields the JSON payload of each `data:` event in an SSE stream. */
async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true })

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
    const body = (await response.json()) as GeminiChunk
    detail = body.error?.message ?? ''
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
  return `Gemini API error ${response.status}${detail ? `: ${detail}` : ''}`
}
