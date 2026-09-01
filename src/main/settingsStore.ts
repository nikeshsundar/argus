import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { ProviderName } from '../shared/types'

export type { ProviderName }

export interface Settings {
  /** Electron accelerator string for the global hotkey. */
  hotkey: string
  /** Provider used for Talk Mode. Agent Mode always requires Claude. */
  talkProvider: ProviderName
  claudeModel: string
  claudeApiKey: string
  geminiModel: string
  geminiApiKey: string
  openaiApiKey: string
  ollamaHost: string
}

/**
 * Ctrl+Space is deliberately avoided as a default: on Windows it toggles the
 * IME language input, so registration quietly loses to the OS on many machines.
 */
const DEFAULTS: Settings = {
  hotkey: 'Control+Shift+Space',
  talkProvider: 'claude',
  claudeModel: 'claude-opus-5',
  claudeApiKey: '',
  geminiModel: 'gemini-3.6-flash',
  geminiApiKey: '',
  openaiApiKey: '',
  ollamaHost: 'http://127.0.0.1:11434'
}

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  if (cache) return cache
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    // No settings file yet (first run), or it is unreadable/corrupt - fall back
    // to defaults rather than failing to start.
    cache = { ...DEFAULTS }
  }
  return cache
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  cache = next
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  return next
}

/** True once the active Talk Mode provider has the credentials it needs. */
export function isProviderConfigured(settings: Settings = loadSettings()): boolean {
  switch (settings.talkProvider) {
    case 'claude':
      return Boolean(settings.claudeApiKey || process.env['ANTHROPIC_API_KEY'])
    case 'gemini':
      return Boolean(settings.geminiApiKey || process.env['GEMINI_API_KEY'])
    case 'openai':
      return Boolean(settings.openaiApiKey || process.env['OPENAI_API_KEY'])
    case 'ollama':
      return true
  }
}
