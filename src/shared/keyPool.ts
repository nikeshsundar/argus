/**
 * Rotation across several API keys, so one exhausted quota does not stop a task.
 *
 * Gemini's free tier is capped per project per model per day, and a long agent
 * run can spend a whole day's allowance in one task. With more than one key the
 * loop can carry on instead of failing halfway through something it already
 * started - which is the part that actually hurts.
 *
 * Kept free of network code so the cooldown arithmetic can be tested directly.
 */

export interface KeyState {
  key: string
  /** Epoch ms before which this key should not be used again. */
  cooldownUntil: number
  /** Why it is resting, for the status line. */
  reason?: string
}

/** A per-day cap will not clear in seconds, whatever the server's retry hint says. */
export const DAILY_COOLDOWN_MS = 15 * 60 * 1000

/** Floor for a short cooldown, so a burst of 429s cannot spin. */
export const MIN_COOLDOWN_MS = 5_000

export function createKeyStates(keys: string[]): KeyState[] {
  // Order is preserved (the first key stays the default) and blanks and exact
  // duplicates are dropped, since a duplicate would just fail twice.
  const seen = new Set<string>()
  const states: KeyState[] = []
  for (const key of keys) {
    const trimmed = key.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    states.push({ key: trimmed, cooldownUntil: 0 })
  }
  return states
}

/** The first key not resting, or null when every one is cooling down. */
export function pickKey(states: KeyState[], now: number): KeyState | null {
  return states.find((state) => state.cooldownUntil <= now) ?? null
}

/**
 * How long to rest a key that was just refused.
 *
 * `retryAfterMs` is the server's own hint. It is ignored when the violation is
 * a daily cap: Gemini answers a per-day 429 with a retry delay of about twenty
 * seconds, which is the per-minute window talking, and honouring it would burn
 * the key again immediately.
 */
export function cooldownFor(detail: string, retryAfterMs: number | null): number {
  if (/perday|per day|requests per day/i.test(detail)) return DAILY_COOLDOWN_MS
  return Math.max(MIN_COOLDOWN_MS, retryAfterMs ?? MIN_COOLDOWN_MS)
}

/** Reads Gemini's retry hint out of an error body, in either form it takes. */
export function parseRetryDelay(detail: string): number | null {
  const match = /retry(?:Delay)?["':\s]*(?:in\s*)?(\d+(?:\.\d+)?)\s*s/i.exec(detail)
  return match ? Math.round(Number(match[1]) * 1000) : null
}

export function restKey(state: KeyState, forMs: number, now: number, reason: string): void {
  state.cooldownUntil = now + forMs
  state.reason = reason
}

/** When the earliest key frees up, for telling the user how long to wait. */
export function soonestAvailable(states: KeyState[]): number | null {
  if (states.length === 0) return null
  return Math.min(...states.map((state) => state.cooldownUntil))
}

/** "3 of 5 keys ready" - what the status line shows. */
export function describePool(states: KeyState[], now: number): string {
  if (states.length === 0) return 'no API keys set'
  const ready = states.filter((state) => state.cooldownUntil <= now).length
  if (states.length === 1) return ready ? '1 key, ready' : '1 key, resting'
  return `${ready} of ${states.length} keys ready`
}
