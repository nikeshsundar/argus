import { TALK_SYSTEM_PROMPT } from './prompt'
import { ProviderUnavailableError, type VisionProvider, type VisionRequest } from './types'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

/**
 * Talk Mode on OpenAI.
 *
 * Written against the REST API with `fetch` rather than the SDK, matching the
 * Gemini provider: this is one endpoint and one response shape, and a
 * dependency that ships a whole client for it would be the largest thing in
 * the bundle for the least reason.
 */
export function createOpenAiProvider(options: { apiKey: string; model: string }): VisionProvider {
  const { apiKey, model } = options

  if (!apiKey) {
    throw new ProviderUnavailableError('No OpenAI API key set. Type "/key sk-..." here.')
  }

  return {
    name: 'openai',

    async ask({
      prompt,
      image,
      history,
      imageAnchor,
      onDelta,
      signal
    }: VisionRequest): Promise<string> {
      // The screenshot rides on one turn only - later questions are about the
      // same screen, so re-sending it would just burn tokens.
      const imagePart = {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${image.toString('base64')}` }
      }

      const messages: unknown[] = [{ role: 'system', content: TALK_SYSTEM_PROMPT }]

      history.forEach((turn, index) => {
        // OpenAI names the model's side "assistant", and only a user turn may
        // carry an image.
        const role = turn.role === 'model' ? 'assistant' : 'user'
        messages.push(
          index === imageAnchor && role === 'user'
            ? { role, content: [imagePart, { type: 'text', text: turn.text }] }
            : { role, content: turn.text }
        )
      })

      messages.push({
        role: 'user',
        content:
          history.length === imageAnchor
            ? [imagePart, { type: 'text', text: prompt }]
            : [{ type: 'text', text: prompt }]
      })

      const response = await fetch(ENDPOINT, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, messages, stream: true, max_completion_tokens: 1024 })
      })

      if (!response.ok || !response.body) {
        throw new Error(await describeFailure(response, model))
      }

      return await consumeStream(response.body, onDelta)
    }
  }
}

interface ChatChunk {
  choices?: { delta?: { content?: string } }[]
  error?: { message?: string }
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void
): Promise<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''

  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true }).replace(/\r/g, '')

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')

      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        // The stream ends with a literal sentinel rather than JSON.
        if (payload === '[DONE]') continue

        const chunk = JSON.parse(payload) as ChatChunk
        if (chunk.error?.message) throw new Error(`OpenAI: ${chunk.error.message}`)

        const delta = chunk.choices?.[0]?.delta?.content
        if (!delta) continue
        answer += delta
        onDelta(delta)
      }
    }
  }

  return answer.trim()
}

/** Turns a status code into something that names the command that fixes it. */
async function describeFailure(response: Response, model: string): Promise<string> {
  let detail = ''
  try {
    detail = ((await response.json()) as ChatChunk).error?.message ?? ''
  } catch {
    // Non-JSON body - the status will have to carry it.
  }

  if (response.status === 401) {
    return 'That OpenAI key was rejected. Add a working one with "/key sk-...".'
  }
  if (response.status === 404 || /does not exist|not found/i.test(detail)) {
    return `OpenAI has no model "${model}" available to this key. Pick another with "/aimodel".`
  }
  if (response.status === 429) {
    return /quota|billing/i.test(detail)
      ? 'That OpenAI key is out of credit. Add billing, or switch back with "/aimodel gemini".'
      : 'Rate limited by OpenAI - try again in a moment.'
  }
  return `OpenAI API error ${response.status}${detail ? `: ${detail}` : ''}`
}
