import { loadSettings } from '../settingsStore'
import { createGeminiProvider } from './gemini'
import { createGeminiAgentProvider } from './geminiAgent'
import { createGeminiTeachProvider } from './geminiTeach'
import { ProviderUnavailableError, type ComputerUseProvider, type VisionProvider } from './types'

/** Builds the Talk Mode provider named in settings. */
export function createTalkProvider(): VisionProvider {
  const settings = loadSettings()

  switch (settings.talkProvider) {
    case 'gemini':
      return createGeminiProvider({
        // An env var is handy in development; the saved key is what ships.
        apiKey: settings.geminiApiKey || process.env['GEMINI_API_KEY'] || '',
        model: settings.geminiModel
      })

    default:
      throw new ProviderUnavailableError(
        `Provider "${settings.talkProvider}" isn't available. Switch with "/provider gemini".`
      )
  }
}

/**
 * Builds the Agent Mode provider. Only Gemini drives the desktop today - the
 * Claude computer-use path is next.
 */
export function createAgentProvider(): ComputerUseProvider {
  const settings = loadSettings()
  const geminiKey = settings.geminiApiKey || process.env['GEMINI_API_KEY'] || ''

  if (!geminiKey) {
    throw new ProviderUnavailableError(
      'Agent Mode needs a Gemini key right now. Add one with "/key <your-key>".'
    )
  }

  return createGeminiAgentProvider({ apiKey: geminiKey, model: settings.agentModel })
}

/**
 * Builds the Teach Mode provider. Shares Gemini's vision with Agent Mode, but
 * nothing else: it points rather than clicks, so it gets its own prompt and its
 * own tools.
 */
export function createTeachProvider(): ReturnType<typeof createGeminiTeachProvider> {
  const settings = loadSettings()
  const geminiKey = settings.geminiApiKey || process.env['GEMINI_API_KEY'] || ''

  if (!geminiKey) {
    throw new ProviderUnavailableError(
      'Teach Mode needs a Gemini key right now. Add one with "/key <your-key>".'
    )
  }

  return createGeminiTeachProvider({ apiKey: geminiKey, model: settings.agentModel })
}
