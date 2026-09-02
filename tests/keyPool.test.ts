import { describe, expect, it } from 'vitest'
import {
  cooldownFor,
  createKeyStates,
  DAILY_COOLDOWN_MS,
  describePool,
  MIN_COOLDOWN_MS,
  parseRetryDelay,
  pickKey,
  restKey,
  soonestAvailable
} from '../src/shared/keyPool'

const NOW = 1_700_000_000_000

describe('createKeyStates', () => {
  it('keeps the given order, so the first key stays the default', () => {
    expect(createKeyStates(['a', 'b', 'c']).map((s) => s.key)).toEqual(['a', 'b', 'c'])
  })

  it('drops blanks and duplicates, which would only fail twice', () => {
    expect(createKeyStates(['a', '', '  ', 'a', 'b']).map((s) => s.key)).toEqual(['a', 'b'])
  })

  it('trims, since a pasted key often carries whitespace', () => {
    expect(createKeyStates([' a ']).map((s) => s.key)).toEqual(['a'])
  })
})

describe('pickKey', () => {
  it('returns the first key that is not resting', () => {
    const states = createKeyStates(['a', 'b'])
    restKey(states[0]!, 60_000, NOW, 'quota')
    expect(pickKey(states, NOW)?.key).toBe('b')
  })

  it('returns null when every key is resting', () => {
    const states = createKeyStates(['a', 'b'])
    for (const state of states) restKey(state, 60_000, NOW, 'quota')
    expect(pickKey(states, NOW)).toBeNull()
  })

  it('brings a key back once its cooldown has passed', () => {
    const states = createKeyStates(['a'])
    restKey(states[0]!, 60_000, NOW, 'quota')
    expect(pickKey(states, NOW + 59_000)).toBeNull()
    expect(pickKey(states, NOW + 61_000)?.key).toBe('a')
  })

  it('handles an empty pool without throwing', () => {
    expect(pickKey([], NOW)).toBeNull()
  })
})

describe('parseRetryDelay', () => {
  it('reads both shapes Gemini returns', () => {
    expect(parseRetryDelay('"retryDelay": "21s"')).toBe(21_000)
    expect(parseRetryDelay('Please retry in 21.050322998s.')).toBe(21_050)
  })

  it('returns null when there is no hint to read', () => {
    expect(parseRetryDelay('You exceeded your current quota')).toBeNull()
  })
})

describe('cooldownFor', () => {
  it('ignores the server hint on a per-day cap', () => {
    // Gemini answers a per-day 429 with ~21s, which is the per-minute window
    // talking. Honouring it would spend the key again straight away.
    const detail = 'quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier'
    expect(cooldownFor(detail, 21_000)).toBe(DAILY_COOLDOWN_MS)
  })

  it('honours the hint for an ordinary rate limit', () => {
    expect(cooldownFor('rate limit', 30_000)).toBe(30_000)
  })

  it('never rests for less than the floor, so a burst cannot spin', () => {
    expect(cooldownFor('rate limit', 100)).toBe(MIN_COOLDOWN_MS)
    expect(cooldownFor('rate limit', null)).toBe(MIN_COOLDOWN_MS)
  })
})

describe('reporting', () => {
  it('counts what is ready', () => {
    const states = createKeyStates(['a', 'b', 'c'])
    restKey(states[0]!, 60_000, NOW, 'quota')
    expect(describePool(states, NOW)).toBe('2 of 3 keys ready')
  })

  it('reads naturally for a single key', () => {
    const states = createKeyStates(['a'])
    expect(describePool(states, NOW)).toBe('1 key, ready')
    restKey(states[0]!, 60_000, NOW, 'quota')
    expect(describePool(states, NOW)).toBe('1 key, resting')
  })

  it('says so when there are none', () => {
    expect(describePool([], NOW)).toBe('no API keys set')
  })

  it('reports the earliest key to come back, for the wait message', () => {
    const states = createKeyStates(['a', 'b'])
    restKey(states[0]!, 90_000, NOW, 'quota')
    restKey(states[1]!, 30_000, NOW, 'quota')
    expect(soonestAvailable(states)).toBe(NOW + 30_000)
    expect(soonestAvailable([])).toBeNull()
  })
})
