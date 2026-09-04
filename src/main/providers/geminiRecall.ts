import { callGemini, consumeStream, describeGeminiFailure, extractText } from './geminiClient'
import { RECALL_SYSTEM_PROMPT } from './prompt'
import { ProviderUnavailableError } from './types'

/** One frame on its way to the model, already captioned with its age. */
export interface RecallFrame {
  jpeg: Uint8Array
  /** e.g. "[screen 3m ago]" - how the model dates what it is looking at. */
  label: string
}

export interface RecallRequest {
  question: string
  /** Oldest first. The last one should be the live screen, when there is one. */
  frames: RecallFrame[]
  onDelta: (text: string) => void
  signal?: AbortSignal
}

export interface RecallProvider {
  ask(request: RecallRequest): Promise<string>
}

/**
 * Answers a question about a stretch of time rather than a single screen.
 *
 * The whole timeline goes in one user turn, each image preceded by a text part
 * saying how long ago it was. Gemini keeps parts in order, so the captions do
 * the dating for us and the model can say *when* it saw something - which is
 * most of what makes the answer usable.
 */
export function createGeminiRecallProvider(options: {
  apiKey: string
  model: string
}): RecallProvider {
  const { apiKey, model } = options

  if (!apiKey) {
    throw new ProviderUnavailableError('No Gemini API key set. Type "/key <your-key>" here.')
  }

  return {
    async ask({ question, frames, onDelta, signal }: RecallRequest): Promise<string> {
      if (frames.length === 0) {
        throw new Error('There is nothing in screen memory to look through yet.')
      }

      const parts: unknown[] = [
        {
          text: `Here are ${frames.length} screenshots of my screen, oldest first, each labelled with how long ago it was.`
        }
      ]

      for (const frame of frames) {
        parts.push({ text: frame.label })
        parts.push({
          inline_data: { mime_type: 'image/jpeg', data: toBase64(frame.jpeg) }
        })
      }

      parts.push({ text: `My question about that stretch of time: ${question}` })

      const body = {
        systemInstruction: { parts: [{ text: RECALL_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.1 }
      }

      const streamed = await callGemini({
        apiKey,
        model,
        method: 'streamGenerateContent',
        body,
        signal
      })

      if (streamed.ok && streamed.body) return await consumeStream(streamed.body, onDelta)
      if (streamed.status !== 404) throw new Error(await describeGeminiFailure(streamed, model))

      // This model has no streaming method; the plain one still answers.
      const response = await callGemini({ apiKey, model, method: 'generateContent', body, signal })
      if (!response.ok) throw new Error(await describeGeminiFailure(response, model))

      const text = extractText(await response.json())
      if (text) onDelta(text)
      return text
    }
  }
}

/**
 * Frames arrive as Uint8Array rather than Buffer, because everything that
 * decides which ones to send lives in `shared/` and must not depend on Node.
 */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}
