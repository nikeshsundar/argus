import {
  describePause,
  describeYielding,
  pauseVerdict,
  type PauseVerdict
} from '../shared/presence'
import { setOverlayPaused } from './overlayWindow'
import { lastUserInputAt } from './userPresence'

/**
 * Standing aside while the machine is being used.
 *
 * Shared by Agent Mode and workflow replay, which both drive the real pointer
 * and both have the same obligation: the moment someone touches their own
 * computer, it is theirs again.
 */

/** How often the banner is refreshed while paused, so a countdown can tick. */
const TICK_MS = 500

export interface Yielding {
  /** Blocks until the user is idle. False means the task should be abandoned. */
  wait(): Promise<{ ok: true } | { ok: false; reason: string }>
  /** One line for the transcript, or "" if it never had to stand aside. */
  summary(): string
}

export function createYielding(signal: AbortSignal): Yielding {
  let pausedSince: number | null = null
  let totalMs = 0
  let times = 0

  const resume = (): void => {
    if (pausedSince === null) return
    totalMs += Date.now() - pausedSince
    pausedSince = null
    setOverlayPaused(null)
  }

  return {
    async wait(): Promise<{ ok: true } | { ok: false; reason: string }> {
      for (;;) {
        if (signal.aborted) {
          resume()
          return { ok: true } // the caller's own abort check reports this
        }

        const verdict: PauseVerdict = pauseVerdict({
          lastInputAt: lastUserInputAt(),
          pausedSince,
          now: Date.now()
        })

        if (verdict.kind === 'run') {
          resume()
          return { ok: true }
        }

        if (verdict.kind === 'abandon') {
          resume()
          return { ok: false, reason: verdict.reason }
        }

        if (pausedSince === null) {
          pausedSince = Date.now()
          times++
        }
        setOverlayPaused(describePause(Date.now() - pausedSince))

        // Capped so the banner can count down. The verdict still carries the
        // exact remaining time, so the handover back is never late by a tick.
        await sleep(Math.min(verdict.forMs, TICK_MS), signal)
      }
    },

    summary(): string {
      resume()
      return describeYielding(totalMs, times)
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}
