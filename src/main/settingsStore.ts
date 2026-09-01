import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ProviderName = 'claude' | 'openai' | 'ollama'

export interface Settings {
  /** Electron accelerator string for the global hotkey. */
  hotkey: string
  /** Provider used for Talk Mode. Agent Mode always requires Claude. */
  talkProvider: ProviderName
  /** Claude model id used for Talk Mode and (later) Agent Mode. */
  claudeModel: string
  claudeApiKey: string
  openaiApiKey: string
  ollamaHost: string
}

const DEFAULTS: Settings = {
  hotkey: 'Control+Space',
  talkProvider: 'claude',
  claudeModel: 'claude-opus-5',
  claudeApiKey: '',
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
