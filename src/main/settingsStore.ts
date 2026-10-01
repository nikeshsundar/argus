import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { CursorPace } from '../shared/cursorPath'
import { DEFAULT_APPROVAL_MODE, type ApprovalMode } from '../shared/safety'
import { healLimits, NO_LIMITS, type Limits } from '../shared/limits'
import { DEFAULT_MODEL_ID } from '../shared/models'
import { DEFAULT_MINUTES } from '../shared/recall'
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
  /** Model used when Talk Mode is on OpenAI. Each provider keeps its own. */
  openaiModel: string
  ollamaHost: string
  /** How visibly Agent Mode moves the pointer and types. */
  cursorPace: CursorPace
  /**
   * Whether the rolling screen recording is running.
   *
   * Off by default and stored as a plain flag, so what it is doing is
   * inspectable in a text file. The frames themselves are never persisted -
   * only the fact that recording was switched on.
   */
  memoryEnabled: boolean
  /** How many minutes of screen to keep while it is on. */
  memoryMinutes: number
  /** When Agent Mode stops to ask before acting. See `shared/safety.ts`. */
  approvalMode: ApprovalMode
  /** What the agent may ever do, set in advance. See `shared/limits.ts`. */
  limits: Limits
}

/**
 * Alt+` is the default. The obvious pick, Win+`, is already Windows Terminal's
 * quake-mode shortcut, and a keyboard hook can see a key without being able to
 * stop the other app receiving it - so Win+` opens a terminal too. Ctrl+Space
 * is avoided as well: it toggles IME language input and loses to the OS.
 */
const DEFAULTS: Settings = {
  hotkey: 'Alt+`',
  talkProvider: 'gemini',
  claudeModel: 'claude-opus-5',
  claudeApiKey: '',
  geminiModel: DEFAULT_MODEL_ID,
  agentModel: 'gemini-2.5-flash',
  geminiApiKey: '',
  geminiApiKeys: [],
  geminiKeyCooldowns: {},
  openaiApiKey: '',
  openaiModel: 'gpt-5',
  ollamaHost: 'http://127.0.0.1:11434',
  cursorPace: 'natural',
  memoryEnabled: false,
  memoryMinutes: DEFAULT_MINUTES,
  approvalMode: DEFAULT_APPROVAL_MODE,
  limits: NO_LIMITS
}

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/**
 * API keys at rest.
 *
 * The keys are the one genuinely sensitive thing in settings.json, and they
 * used to sit there in plain text - readable by anything running as the user,
 * and easy to leak by copying the file. They are now encrypted with the OS
 * keystore (DPAPI on Windows) via Electron's safeStorage: still bound to this
 * user on this machine, but no longer a plain string on disk.
 *
 * In memory the keys are always plain text, so the rest of the app is
 * unchanged - only the bytes written to and read from disk are wrapped.
 *
 * The wrapper is transparent and backwards compatible:
 *  - A value with the prefix is ciphertext; anything else is read as-is, so a
 *    file written by an older build (or on a system without a keystore) still
 *    works and is re-encrypted the next time settings are saved.
 *  - If the keystore is unavailable, values are left in plain text rather than
 *    failing to start - the same position as before this change, and the only
 *    honest option without a password to derive a key from.
 *  - A value that is marked encrypted but cannot be decrypted (the file was
 *    carried to another machine or account) is dropped to empty, so a bogus
 *    credential is never sent to a provider; the user is prompted to add one.
 */
const SECRET_PREFIX = 'enc.v1:'

function keystoreReady(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encryptSecret(value: string): string {
  if (!value || value.startsWith(SECRET_PREFIX) || !keystoreReady()) return value
  try {
    return SECRET_PREFIX + safeStorage.encryptString(value).toString('base64')
  } catch {
    return value
  }
}

function decryptSecret(value: unknown): string {
  if (typeof value !== 'string') return ''
  if (!value.startsWith(SECRET_PREFIX)) return value // legacy plain text
  if (!keystoreReady()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(SECRET_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
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
    stored.limits = healLimits(stored.limits)
    if (!['sensitive', 'every', 'off'].includes(stored.approvalMode)) {
      stored.approvalMode = DEFAULTS.approvalMode
    }
    if (!stored.geminiKeyCooldowns || typeof stored.geminiKeyCooldowns !== 'object') {
      stored.geminiKeyCooldowns = {}
    }
    // Decrypt the keys back to plain text for use in memory. Dropping blanks
    // keeps an undecryptable entry from lingering as an empty slot.
    stored.geminiApiKey = decryptSecret(stored.geminiApiKey)
    stored.claudeApiKey = decryptSecret(stored.claudeApiKey)
    stored.openaiApiKey = decryptSecret(stored.openaiApiKey)
    stored.geminiApiKeys = stored.geminiApiKeys.map(decryptSecret).filter(Boolean)
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
  // This preview id was used by an earlier build and is now commonly slow or
  // unavailable. Move existing installs to the current fast Agent model.
  if (
    settings.agentModel === 'gemini-3-flash-preview' ||
    settings.agentModel === 'gemini-3.5-flash-lite' ||
    settings.agentModel === 'gemini-3.6-flash' ||
    // The old default. Flash Lite misread screens and reported work it had not
    // checked; it stays in the fallback chain for when Flash is out of quota.
    settings.agentModel === 'gemini-2.5-flash-lite'
  ) {
    settings.agentModel = DEFAULTS.agentModel
  }
  if (inferProviderFromKey(settings.claudeModel)) settings.claudeModel = DEFAULTS.claudeModel
  if (inferProviderFromKey(settings.openaiModel)) settings.openaiModel = DEFAULTS.openaiModel
  return settings
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  cache = next // in memory the keys stay plain text; only the disk copy is wrapped
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  const onDisk = {
    ...next,
    geminiApiKey: encryptSecret(next.geminiApiKey),
    claudeApiKey: encryptSecret(next.claudeApiKey),
    openaiApiKey: encryptSecret(next.openaiApiKey),
    geminiApiKeys: next.geminiApiKeys.map(encryptSecret)
  }
  writeFileSync(file, JSON.stringify(onDisk, null, 2), 'utf8')
  return next
}

/** True once the active Talk Mode provider has the credentials it needs. */
export function isProviderConfigured(settings: Settings = loadSettings()): boolean {
  switch (settings.talkProvider) {
    case 'gemini':
      return Boolean(settings.geminiApiKey || process.env['GEMINI_API_KEY'])
    case 'openai':
      return Boolean(settings.openaiApiKey || process.env['OPENAI_API_KEY'])
    case 'claude':
      return Boolean(settings.claudeApiKey || process.env['ANTHROPIC_API_KEY'])
    case 'ollama':
      // Local, so there is no key to be missing. Whether the server is up is
      // answered better by the first request than by a guess here.
      return true
    default:
      return false
  }
}
