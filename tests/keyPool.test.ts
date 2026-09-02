import { describe, expect, it } from 'vitest'
import {
  cooldownFor,
  createKeyStates,
  DAILY_COOLDOWN_MS,
  INVALID_COOLDOWN_MS,
  keyFingerprint,
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

describe('rejected credentials', () => {
  it('rests a 401 key for the session, not for a quota window', () => {
    // A key the server calls invalid will still be invalid in twenty seconds.
    expect(cooldownFor('invalid authentication credentials', 21_000, 401)).toBe(
      INVALID_COOLDOWN_MS
    )
    expect(cooldownFor('forbidden', null, 403)).toBe(INVALID_COOLDOWN_MS)
  })

  it('still treats a 429 as a quota window', () => {
    expect(cooldownFor('rate limit', 30_000, 429)).toBe(30_000)
  })

  it('lets a good key serve a request a bad key refused', () => {
    // The bug this came from: one invalid key in the pool failed requests that
    // the two working keys either side of it could have served.
    const states = createKeyStates(['broken', 'good'])
    restKey(states[0]!, INVALID_COOLDOWN_MS, NOW, '401')
    expect(pickKey(states, NOW)?.key).toBe('good')
    // And it stays skipped for the whole session, not just a moment.
    expect(pickKey(states, NOW + 60 * 60 * 1000)?.key).toBe('good')
  })
})

describe('keyFingerprint', () => {
  it('is short and stable, so a cooldown can be stored without the secret', () => {
    expect(keyFingerprint('AQ.Ab8RN6LWQOpQPO_EIAFdOwcqu')).toBe('EIAFdOwcqu'.slice(-8))
    expect(keyFingerprint('  AIzaSyEXAMPLE0000000000abcd1234  ')).toBe('abcd1234')
  })

  it('tells realistic keys apart', () => {
    const a = 'AIzaSyEXAMPLE00000000000000000000000AAAA'
    const b = 'AIzaSyEXAMPLE00000000000000000000000BBBB'
    expect(keyFingerprint(a)).not.toBe(keyFingerprint(b))
  })
})

describe('ordering when a key is added', () => {
  it('a newly added key is tried before the exhausted one it replaces', () => {
    // The reported bug: /key appended, so the dead key kept its place at the
    // front and every request was spent rediscovering that it was dead.
    const added = 'fresh'
    const existing = ['spent', 'older']
    const reordered = [added, ...existing.filter((key) => key !== added)]
    const states = createKeyStates(reordered)
    expect(pickKey(states, NOW)?.key).toBe('fresh')
  })

  it('a restored cooldown keeps a spent key out of the way after a restart', () => {
    const states = createKeyStates(['spent', 'fresh'])
    // Simulating what syncStates does with a persisted cooldown.
    states[0]!.cooldownUntil = NOW + DAILY_COOLDOWN_MS
    expect(pickKey(states, NOW)?.key).toBe('fresh')
  })
})
