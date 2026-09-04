import { describe, expect, it } from 'vitest'
import { modelCandidates, preferAvailable } from '../src/main/providers/geminiClient'

describe('modelCandidates', () => {
  it('tries the chosen model first', () => {
    expect(modelCandidates('a', ['b'])).toEqual(['a', 'b'])
  })

  it('never tries the same model twice', () => {
    // Settings can hold the same id for the quick model and the Talk model.
    // Trying it again doubles the wait before reporting a failure that was
    // already decided the first time.
    expect(modelCandidates('a', ['a'])).toEqual(['a'])
    expect(modelCandidates('a', ['b', 'a', 'b'])).toEqual(['a', 'b'])
  })

  it('ignores blanks, so an unset setting is not an empty request', () => {
    expect(modelCandidates('a', ['', 'b'])).toEqual(['a', 'b'])
  })

  it('is just the model when there is nothing to fall back to', () => {
    expect(modelCandidates('a')).toEqual(['a'])
    expect(modelCandidates('a', [])).toEqual(['a'])
  })
})

describe('preferAvailable', () => {
  const NOW = 1_700_000_000_000

  it('leaves the order alone when nothing is resting', () => {
    expect(preferAvailable(['a', 'b'], new Map(), NOW)).toEqual(['a', 'b'])
  })

  it('skips a model that just refused', () => {
    // The whole point: while a model is down, every request should go straight
    // to the one that works instead of paying three failed round trips first.
    const resting = new Map([['a', NOW + 30_000]])
    expect(preferAvailable(['a', 'b'], resting, NOW)).toEqual(['b'])
  })

  it('brings a model back once its cooldown has passed', () => {
    const resting = new Map([['a', NOW - 1]])
    expect(preferAvailable(['a', 'b'], resting, NOW)).toEqual(['a', 'b'])
  })

  it('tries everything rather than nothing when all are resting', () => {
    // Something has to be attempted, and a stale cooldown is a worse reason to
    // fail than a real 503.
    const resting = new Map([
      ['a', NOW + 10_000],
      ['b', NOW + 10_000]
    ])
    expect(preferAvailable(['a', 'b'], resting, NOW)).toEqual(['a', 'b'])
  })
})
