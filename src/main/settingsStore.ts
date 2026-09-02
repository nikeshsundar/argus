import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { CursorPace } from '../shared/cursorPath'
import { inferProviderFromKey } from '../shared/keys'
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
  /**
   * Model for Agent and Teach steps, which is a different job from Talk: a
   * dozen quick "which control next" calls rather than one answer worth
   * waiting for. Measured against the live API, gemini-3.6-flash spent ~11s
   * per turn deliberating while this one answers in ~1.5s and still lands
   * within 2px of a target. Free-tier quota is per model, so it also gets its
   * own daily allowance.
   */
  agentModel: string
  geminiApiKey: string
  /**
   * Extra Gemini keys, tried in order when the one before is over quota. The
   * free tier is capped per project per day, so a second key in a *different*
   * project is what actually buys headroom - another key in the same project
   * shares the same exhausted allowance.
   */
  geminiApiKeys: string[]
  /**
   * When each key's quota is expected back, keyed by the last 8 characters of
   * the key rather than the key itself - the secret is already in this file
   * once and does not need to be in it twice.
   *
   * Persisted because a daily cap outlives the session that discovered it.
   * Without this, every restart spends a request re-learning that yesterday's
   * exhausted key is still exhausted, and does it before reaching the good one.
   */
  geminiKeyCooldowns: Record<string, number>
  openaiApiKey: string
  ollamaHost: string
  /** How visibly Agent Mode moves the pointer and types. */
  cursorPace: CursorPace
}

/**
 * Alt+` is the default. The obvious pick, Win+`, is already Windows Terminal's
 * quake-mode shortcut, and a keyboard hook can see a key without being able to
 * stop the other app receiving it - so Win+` opens a terminal too. Ctrl+Space
 * is avoided as well: it toggles IME language input and loses to the OS.
 */
const DEFAULTS: Settings = {
  hotkey: 'Alt+`',
  talkProvider: 'claude',
  claudeModel: 'claude-opus-5',
  claudeApiKey: '',
  geminiModel: 'gemini-3.6-flash',
  agentModel: 'gemini-3.5-flash-lite',
  geminiApiKey: '',
  geminiApiKeys: [],
  geminiKeyCooldowns: {},
  openaiApiKey: '',
  ollamaHost: 'http://127.0.0.1:11434',
  cursorPace: 'natural'
}

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Defaults we have shipped before, so an old one can be upgraded in place. */
const SUPERSEDED_HOTKEYS = ['Control+Space', 'Control+Shift+Space', 'Super+`']

export function loadSettings(): Settings {
  if (cache) return cache
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    const stored = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
    // Move users off a previous default rather than stranding them on it.
    if (SUPERSEDED_HOTKEYS.includes(stored.hotkey)) stored.hotkey = DEFAULTS.hotkey
    if (!Array.isArray(stored.geminiApiKeys)) stored.geminiApiKeys = []
    if (!stored.geminiKeyCooldowns || typeof stored.geminiKeyCooldowns !== 'object') {
      stored.geminiKeyCooldowns = {}
    }
    cache = healModelNames(stored)
  } catch {
    // No settings file yet (first run), or it is unreadable/corrupt - fall back
    // to defaults rather than failing to start.
    cache = { ...DEFAULTS }
  }
  return cache
}

/**
 * Undoes an API key typed into "/model".
 *
 * A key stored as a model name reaches the provider as a model id and comes
 * back as an opaque 400 that names neither the command nor the field. Worse, it
 * survives a restart: the bad value is read, then written straight back out.
 * Repairing it on the way in is the only place the cycle can be broken.
 */
function healModelNames(settings: Settings): Settings {
  if (inferProviderFromKey(settings.geminiModel)) settings.geminiModel = DEFAULTS.geminiModel
  if (inferProviderFromKey(settings.agentModel)) settings.agentModel = DEFAULTS.agentModel
  if (inferProviderFromKey(settings.claudeModel)) settings.claudeModel = DEFAULTS.claudeModel
  return settings
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
