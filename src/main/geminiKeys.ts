import {
  cooldownFor,
  createKeyStates,
  DAILY_COOLDOWN_MS,
  describePool,
  keyFingerprint,
  parseRetryDelay,
  pickKey,
  restKey,
  soonestAvailable,
  type KeyState
} from '../shared/keyPool'
import { loadSettings, updateSettings } from './settingsStore'

/**
 * The live rotation state.
 *
 * Module-level because cooldowns have to outlive a single request - a key
 * refused during step 3 must still be resting at step 4. Rebuilt whenever the
 * configured keys change, so adding one with "/key" takes effect immediately.
 */
let states: KeyState[] = []
let signature = ''

/** Every Gemini key available, in preference order. */
export function configuredKeys(): string[] {
  const settings = loadSettings()
  const env = process.env['GEMINI_API_KEY']
  return [...settings.geminiApiKeys, settings.geminiApiKey, env ?? ''].filter(Boolean)
}

function syncStates(): KeyState[] {
  const keys = configuredKeys()
  const next = keys.join('|')
  if (next !== signature) {
    // Carry over cooldowns for keys that survived the edit; a key that was
    // just refused should not become usable merely because another was added.
    const previous = new Map(states.map((state) => [state.key, state]))
    const stored = loadSettings().geminiKeyCooldowns
    states = createKeyStates(keys).map((state) => {
      const live = previous.get(state.key)
      if (live) return live
      // A daily cap outlives the session that found it, so a restart must not
      // hand back a key that is still exhausted - it would be spent relearning
      // that, and spent before reaching a key that actually works.
      const until = stored[keyFingerprint(state.key)] ?? 0
      return until > Date.now() ? { ...state, cooldownUntil: until, reason: 'quota' } : state
    })
    signature = next
  }
  return states
}

/** The next key to try, or null when all of them are resting. */
export function takeKey(now: number = Date.now()): string | null {
  return pickKey(syncStates(), now)?.key ?? null
}

/**
 * Records a refusal so this key is skipped.
 *
 * `status` separates the two reasons a key gets refused: 429 is a quota window
 * that reopens, while 401 and 403 mean the credential itself is wrong and no
 * amount of waiting will fix it.
 */
export function restAfterRefusal(
  key: string,
  detail: string,
  status = 429,
  now: number = Date.now()
): void {
  const state = syncStates().find((candidate) => candidate.key === key)
  if (!state) return
  restKey(state, cooldownFor(detail, parseRetryDelay(detail), status), now, detail.slice(0, 120))
  persistCooldowns(now)
}

/** Writes cooldowns to disk, dropping ones that have already elapsed. */
function persistCooldowns(now: number): void {
  const cooldowns: Record<string, number> = {}
  for (const state of states) {
    if (state.cooldownUntil > now) cooldowns[keyFingerprint(state.key)] = state.cooldownUntil
  }
  updateSettings({ geminiKeyCooldowns: cooldowns })
}

/** Clears every cooldown - for when the user knows a quota has reset. */
export function forgetCooldowns(): void {
  for (const state of syncStates()) {
    state.cooldownUntil = 0
    delete state.reason
  }
  updateSettings({ geminiKeyCooldowns: {} })
}

/** Keys the server has rejected outright, for telling the user which to replace. */
export function rejectedKeys(now: number = Date.now()): string[] {
  return syncStates()
    .filter((state) => state.cooldownUntil > now + DAILY_COOLDOWN_MS)
    .map((state) => state.key)
}

/** True while at least one more key is worth trying. */
export function hasReadyKey(now: number = Date.now()): boolean {
  return pickKey(syncStates(), now) !== null
}

export function poolSize(): number {
  return syncStates().length
}

export function poolStatus(now: number = Date.now()): string {
  return describePool(syncStates(), now)
}

/** Per-key state for the "/keys" listing. */
export function poolRows(now: number = Date.now()): { key: string; status: string }[] {
  return syncStates().map((state) => {
    if (state.cooldownUntil <= now) return { key: state.key, status: 'ready' }
    const seconds = Math.ceil((state.cooldownUntil - now) / 1000)
    if (seconds > 12 * 60 * 60) return { key: state.key, status: 'rejected — replace it' }
    const wait = seconds > 90 ? `${Math.round(seconds / 60)} min` : `${seconds}s`
    return { key: state.key, status: `resting, back in ~${wait}` }
  })
}

/** How long until the pool can be used again, in seconds. */
export function secondsUntilReady(now: number = Date.now()): number {
  const soonest = soonestAvailable(syncStates())
  return soonest === null ? 0 : Math.max(0, Math.ceil((soonest - now) / 1000))
}
