import { describe, expect, it } from 'vitest'
import { modelCandidates } from '../src/main/providers/geminiClient'

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
