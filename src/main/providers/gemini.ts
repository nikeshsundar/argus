import { callGemini, consumeStream, describeGeminiFailure, extractText } from './geminiClient'
import { OVERLOAD_FALLBACKS } from '../../shared/models'
import { MODEL_IMAGE_MIME } from '../screenshot'
import { TALK_SYSTEM_PROMPT } from './prompt'
import { ProviderUnavailableError, type VisionProvider, type VisionRequest } from './types'

/**
 * Not every key/model combination exposes `streamGenerateContent` - some tiers
 * only offer `generateContent`. Remember which one worked so we pay the failed
 * streaming request at most once per model.
 */
const streamingSupport = new Map<string, boolean>()

export function createGeminiProvider(options: { apiKey: string; model: string }): VisionProvider {
  const { apiKey, model } = options

  if (!apiKey) {
    throw new ProviderUnavailableError('No Gemini API key set. Type "/key <your-key>" here.')
  }

  return {
    name: 'gemini',

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
        inline_data: { mime_type: MODEL_IMAGE_MIME, data: image.toString('base64') }
      }

      const contents = history.map((turn, index) => ({
        role: turn.role,
        parts: index === imageAnchor ? [imagePart, { text: turn.text }] : [{ text: turn.text }]
      }))

      contents.push({
        role: 'user',
        parts:
          history.length === imageAnchor ? [imagePart, { text: prompt }] : [{ text: prompt }]
      })

      const body = {
        systemInstruction: { parts: [{ text: TALK_SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: 1024, temperature: 0.2 }
      }

      /**
       * Talk Mode does get a fallback, but never a silent one.
       *
       * The argument against was that someone who chose a model with
       * "/aimodel" should not be answered by a different one. That still
       * holds - but the alternative, when their model is down, is Talk Mode
       * simply not working, which is worse. So it answers and says who
       * answered, and the choice stays the user's to make again.
       */
      let answeredBy = model
      const note = (chosen: string): void => {
        answeredBy = chosen
      }

      if (streamingSupport.get(model) !== false) {
        const response = await callGemini({
          apiKey,
          model,
          fallbackModels: OVERLOAD_FALLBACKS,
          onModelChosen: note,
          method: 'streamGenerateContent',
          body,
          signal
        })

        if (response.ok && response.body) {
          streamingSupport.set(model, true)
          const answer = await consumeStream(response.body, onDelta)
          return withSubstitution(answer, model, answeredBy, onDelta)
        }

        // A 404 here means this model has no streaming method - fall through
        // and try the plain one. Anything else is a real failure.
        if (response.status !== 404) throw new Error(await describeGeminiFailure(response, model))
        streamingSupport.set(model, false)
      }

      const response = await callGemini({
        apiKey,
        model,
        fallbackModels: OVERLOAD_FALLBACKS,
        onModelChosen: note,
        method: 'generateContent',
        body,
        signal
      })
      if (!response.ok) throw new Error(await describeGeminiFailure(response, model))

      const text = extractText(await response.json())
      if (text) onDelta(text)
      return withSubstitution(text, model, answeredBy, onDelta)
    }
  }
}

/**
 * Appends a note when a different model answered.
 *
 * Streamed to the bar as well as returned, so the line appears with the answer
 * rather than replacing it after the fact.
 */
function withSubstitution(
  answer: string,
  asked: string,
  answered: string,
  onDelta: (text: string) => void
): string {
  if (answered === asked) return answer
  const note = `\n\n— ${asked} was not responding, so ${answered} answered instead.`
  onDelta(note)
  return answer + note
}
