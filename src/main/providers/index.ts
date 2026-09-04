import { OVERLOAD_FALLBACKS } from '../../shared/models'
import { loadSettings } from '../settingsStore'
import { createClaudeProvider } from './claude'
import { createGeminiProvider } from './gemini'
import { createOpenAiProvider } from './openai'
import { createGeminiAgentProvider } from './geminiAgent'
import { createGeminiRecallProvider, type RecallProvider } from './geminiRecall'
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

    case 'claude':
      return createClaudeProvider({
        apiKey: settings.claudeApiKey || process.env['ANTHROPIC_API_KEY'] || '',
        model: settings.claudeModel
      })

    case 'openai':
      return createOpenAiProvider({
        apiKey: settings.openaiApiKey || process.env['OPENAI_API_KEY'] || '',
        model: settings.openaiModel
      })

    default:
      // Ollama is on the menu but has no vision implementation yet. Saying so
      // beats a provider that silently answers nothing.
      throw new ProviderUnavailableError(
        `Talk Mode cannot use ${settings.talkProvider} yet. Pick another with "/aimodel".`
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

  // Models go down one at a time, so one alternative is not enough: the Talk
  // model first, then a chain that does not depend on either choice.
  return createGeminiAgentProvider({
    apiKey: geminiKey,
    model: settings.agentModel,
    fallbackModels: [settings.geminiModel, ...OVERLOAD_FALLBACKS]
  })
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

  return createGeminiTeachProvider({
    apiKey: geminiKey,
    model: settings.agentModel,
    fallbackModels: [settings.geminiModel, ...OVERLOAD_FALLBACKS]
  })
}

/**
 * Builds the screen-memory provider.
 *
 * Runs on the Talk model rather than the fast agent one: reading an error code
 * out of a downscaled frame is exactly the kind of careful looking the quick
 * model was chosen to skip.
 */
export function createRecallProvider(): RecallProvider {
  const settings = loadSettings()
  const geminiKey = settings.geminiApiKey || process.env['GEMINI_API_KEY'] || ''

  if (!geminiKey) {
    throw new ProviderUnavailableError(
      'Screen memory needs a Gemini key to answer. Add one with "/key <your-key>".'
    )
  }

  return createGeminiRecallProvider({ apiKey: geminiKey, model: settings.geminiModel })
}
