import { describe, expect, it } from 'vitest'
import {
  describePause,
  describeYielding,
  MAX_PAUSE_MS,
  pauseVerdict,
  RESUME_AFTER_MS
} from '../src/shared/presence'

const NOW = 1_700_000_000_000

describe('pauseVerdict', () => {
  it('runs when nobody has touched anything', () => {
    expect(pauseVerdict({ lastInputAt: 0, pausedSince: null, now: NOW })).toEqual({ kind: 'run' })
  })

  it('waits the moment the user does something', () => {
    const verdict = pauseVerdict({ lastInputAt: NOW - 200, pausedSince: NOW - 200, now: NOW })
    expect(verdict.kind).toBe('wait')
  })

  it('asks to be woken exactly when the quiet period is up, not on a tick', () => {
    // A fixed poll would add up to its own interval of dead time to every
    // handover; this makes the agent pick up the instant it may.
    const verdict = pauseVerdict({ lastInputAt: NOW - 1_000, pausedSince: NOW - 1_000, now: NOW })
    expect(verdict).toEqual({ kind: 'wait', forMs: RESUME_AFTER_MS - 1_000 })
  })

  it('resumes once the user has been quiet long enough', () => {
    expect(
      pauseVerdict({ lastInputAt: NOW - RESUME_AFTER_MS, pausedSince: NOW - 9_000, now: NOW })
    ).toEqual({ kind: 'run' })
  })

  it('does not resume a millisecond early', () => {
    expect(
      pauseVerdict({ lastInputAt: NOW - RESUME_AFTER_MS + 1, pausedSince: NOW - 9_000, now: NOW }).kind
    ).toBe('wait')
  })

  it('gives up once the user has been working far too long', () => {
    // The plan came from a screenshot. After this much real use, that screen is
    // gone, and resuming would click coordinates that now mean something else.
    const verdict = pauseVerdict({
      lastInputAt: NOW - 100,
      pausedSince: NOW - MAX_PAUSE_MS,
      now: NOW
    })
    expect(verdict.kind).toBe('abandon')
    if (verdict.kind === 'abandon') {
      expect(verdict.reason).toContain('screen this task was planned against')
    }
  })

  it('never gives up while it is still running', () => {
    // pausedSince null means it was never interrupted; a long task is not a
    // reason to abandon anything.
    expect(
      pauseVerdict({ lastInputAt: NOW - RESUME_AFTER_MS, pausedSince: null, now: NOW })
    ).toEqual({ kind: 'run' })
  })

  it('prefers resuming over abandoning when the user has just stopped', () => {
    // Long pause, but they went quiet - finishing the task is what they wanted.
    expect(
      pauseVerdict({
        lastInputAt: NOW - RESUME_AFTER_MS,
        pausedSince: NOW - MAX_PAUSE_MS * 2,
        now: NOW
      })
    ).toEqual({ kind: 'run' })
  })
})

describe('describePause', () => {
  it('says who has control, without a countdown at first', () => {
    expect(describePause(1_000)).toBe('Paused - you have control')
  })

  it('shows how long once it has been a while', () => {
    expect(describePause(20_000)).toContain('20s')
  })

  it('warns before it abandons, rather than just stopping', () => {
    const text = describePause(MAX_PAUSE_MS - 10_000)
    expect(text).toContain('Giving up in')
    expect(text).toContain('10s')
  })
})

describe('describeYielding', () => {
  it('says nothing when it never had to stand aside', () => {
    expect(describeYielding(0, 0)).toBe('')
  })

  it('explains the wall-clock time, so a slow run is not misread', () => {
    expect(describeYielding(90_000, 3)).toBe('Stood aside 3 times while you worked (90s total).')
  })

  it('gets the singular right', () => {
    expect(describeYielding(4_000, 1)).toContain('1 time while')
  })
})
