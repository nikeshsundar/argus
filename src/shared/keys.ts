import type { ProviderName } from './types'

/**
 * Guesses which provider an API key belongs to from its prefix, so pasting a
 * key with the "wrong" provider selected doesn't silently misfile it.
 * Returns null when the format isn't recognised.
 */
export function inferProviderFromKey(key: string): ProviderName | null {
  if (/^sk-ant-/i.test(key)) return 'claude'
  // Google issues both AIza... (AI Studio) and AQ.... (newer) key formats.
  if (/^(AIza|AQ\.)/.test(key)) return 'gemini'
  if (/^sk-/i.test(key)) return 'openai'
  return null
}
