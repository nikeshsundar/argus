import { callGemini, describeGeminiFailure, type GeminiResponse } from './providers/geminiClient'
import { ProviderUnavailableError } from './providers/types'
import { configuredKeys } from './geminiKeys'
import { OVERLOAD_FALLBACKS } from '../shared/models'
import { loadSettings } from './settingsStore'

/**
 * Cleaning up as part of transcribing, rather than after it.
 *
 * A plain speech-to-text engine returns what was said - "um, open youtube and
 * uh search for mister beast". A model can return what was meant. Doing both in
 * one pass is why this reads like dictation rather than a transcript.
 */
const PROMPT = `Write down every word the speaker says, in order, exactly as spoken.

This is dictation. Completeness is what matters: a dropped word changes what the
computer will do. Never summarise, shorten, rephrase, answer, or leave anything
out, however long or rambling the speech is.

The only changes permitted:
- Drop standalone filler sounds: "um", "uh", "er", "hmm".
- Write a dictated form the way it is meant: "github dot com" becomes "github.com".
- Spell well-known app, site and brand names the way they are normally written.

Add nothing that was not said. If part of the audio is unclear, transcribe your
best guess rather than omitting it. Output the words alone: no quotes, no
preamble, no commentary. If there is no speech at all, output nothing.`

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
    // Voice is not worth losing to one busy model, and the obvious
    // alternative can be busy too.
    fallbackModels: [settings.geminiModel, ...OVERLOAD_FALLBACKS],
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
