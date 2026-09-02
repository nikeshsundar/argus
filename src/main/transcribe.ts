import { callGemini, describeGeminiFailure, type GeminiResponse } from './providers/geminiClient'
import { ProviderUnavailableError } from './providers/types'
import { configuredKeys } from './geminiKeys'
import { loadSettings } from './settingsStore'

/**
 * Cleaning up as part of transcribing, rather than after it.
 *
 * A plain speech-to-text engine returns what was said - "um, open youtube and
 * uh search for mister beast". A model can return what was meant. Doing both in
 * one pass is why this reads like dictation rather than a transcript.
 */
const PROMPT = `Transcribe exactly what the speaker asked for, as a single instruction.

- Remove filler words (um, uh, like), false starts and repetitions.
- Fix obvious mis-hearings of well-known product, app and brand names.
- Keep their wording otherwise. Do not rephrase, summarise, answer, or add anything.
- If the audio contains no intelligible speech, output nothing at all.

Output only the cleaned instruction: no quotes, no preamble, no trailing full stop.`

/** How long a clip may be. Beyond this it is a stuck key, not a sentence. */
export const MAX_CLIP_SECONDS = 60

/**
 * Turns recorded speech into the text that goes in the bar.
 *
 * Uses the agent model rather than the Talk one: this is transcription, where
 * speed matters and depth does not, and it keeps voice off Talk Mode's daily
 * quota.
 */
export async function transcribe(wav: Buffer, signal?: AbortSignal): Promise<string> {
  if (configuredKeys().length === 0) {
    throw new ProviderUnavailableError('Add a Gemini key first — type "/key <your-key>".')
  }

  const settings = loadSettings()
  const response = await callGemini({
    apiKey: configuredKeys()[0]!,
    model: settings.agentModel,
    method: 'generateContent',
    signal,
    thinking: 'low',
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'audio/wav', data: wav.toString('base64') } },
            { text: PROMPT }
          ]
        }
      ],
      generationConfig: { temperature: 0 }
    }
  })

  if (!response.ok) throw new Error(await describeGeminiFailure(response, settings.agentModel))

  const payload = (await response.json()) as GeminiResponse
  if (payload.error?.message) throw new Error(`Gemini: ${payload.error.message}`)

  return (payload.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && part.text)
    .map((part) => part.text)
    .join('')
    .trim()
}
