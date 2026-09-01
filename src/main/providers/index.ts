import { loadSettings } from '../settingsStore'
import { createClaudeProvider } from './claude'
import { createGeminiProvider } from './gemini'
import { ProviderUnavailableError, type VisionProvider } from './types'

/** Builds the Talk Mode provider named in settings. */
export function createTalkProvider(): VisionProvider {
  const settings = loadSettings()

  switch (settings.talkProvider) {
    case 'claude':
      return createClaudeProvider({
        // An env var is handy in development; the saved key is what ships.
        apiKey: settings.claudeApiKey || process.env['ANTHROPIC_API_KEY'] || '',
        model: settings.claudeModel
      })

    case 'gemini':
      return createGeminiProvider({
        apiKey: settings.geminiApiKey || process.env['GEMINI_API_KEY'] || '',
        model: settings.geminiModel
      })

    default:
      throw new ProviderUnavailableError(
        `Provider "${settings.talkProvider}" isn't implemented yet. Use "/provider claude" or "/provider gemini".`
      )
  }
}
