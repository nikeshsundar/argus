import {
  cooldownFor,
  createKeyStates,
  describePool,
  parseRetryDelay,
  pickKey,
  restKey,
  soonestAvailable,
  type KeyState
} from '../shared/keyPool'
import { loadSettings } from './settingsStore'

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
    states = createKeyStates(keys).map((state) => previous.get(state.key) ?? state)
    signature = next
  }
  return states
}

/** The next key to try, or null when all of them are resting. */
export function takeKey(now: number = Date.now()): string | null {
  return pickKey(syncStates(), now)?.key ?? null
}

/** Records a refusal so this key is skipped until its quota window moves on. */
export function restAfterRefusal(key: string, detail: string, now: number = Date.now()): void {
  const state = syncStates().find((candidate) => candidate.key === key)
  if (!state) return
  restKey(state, cooldownFor(detail, parseRetryDelay(detail)), now, detail.slice(0, 120))
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

/** How long until the pool can be used again, in seconds. */
export function secondsUntilReady(now: number = Date.now()): number {
  const soonest = soonestAvailable(syncStates())
  return soonest === null ? 0 : Math.max(0, Math.ceil((soonest - now) / 1000))
}
