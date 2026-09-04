/**
 * When the agent should get out of the way.
 *
 * Agent Mode drives the real mouse and keyboard, so while it works the machine
 * is not yours. The amber frame has been saying "don't touch anything" for as
 * long as a task takes, which is the single most annoying thing about the whole
 * product.
 *
 * So: touch the mouse or keyboard and the agent stops between steps and hands
 * control back. Stop for a moment and it carries on where it was. This file
 * holds the decision - when to run, when to wait, when to give up - with no
 * Electron and no timers, so every branch of it can be tested.
 */

/**
 * Quiet needed before the agent picks up again.
 *
 * Long enough to type a sentence or read a line without it grabbing the
 * pointer back mid-thought; short enough that a deliberate handover does not
 * feel like a hang. Three seconds tested better than one, where finishing a
 * word was enough to lose the mouse again.
 */
export const RESUME_AFTER_MS = 3_000

/**
 * How long the agent will wait before abandoning the task.
 *
 * Not a performance limit - a safety one. Its plan was formed from a
 * screenshot, and after a couple of minutes of you working, that screen is
 * gone: different windows, different scroll position, different everything.
 * Resuming into it would click coordinates that now mean something else.
 * Coming back from lunch to a machine that starts driving itself is exactly
 * the behaviour that makes people uninstall this.
 */
export const MAX_PAUSE_MS = 120_000

export type PauseVerdict =
  /** Nobody is using the machine; carry on. */
  | { kind: 'run' }
  /** Someone is; check again in this many ms. */
  | { kind: 'wait'; forMs: number }
  /** They have been at it too long for the plan to still make sense. */
  | { kind: 'abandon'; reason: string }

export interface PresenceState {
  /** When the user last clicked, typed or scrolled. 0 if they never have. */
  lastInputAt: number
  /** When the agent first started waiting for them, or null if it is running. */
  pausedSince: number | null
  now: number
}

/**
 * Decides what the agent should do right now.
 *
 * Checked between steps rather than during one: a half-finished drag or a
 * partly typed string is worse than either finishing it or never starting.
 * Escape is not user activity - that means stop, and it is handled elsewhere.
 */
export function pauseVerdict(state: PresenceState): PauseVerdict {
  const quietFor = state.now - state.lastInputAt

  if (quietFor >= RESUME_AFTER_MS) return { kind: 'run' }

  if (state.pausedSince !== null && state.now - state.pausedSince >= MAX_PAUSE_MS) {
    return {
      kind: 'abandon',
      reason:
        `Stopped: you have been using the machine for ${Math.round(MAX_PAUSE_MS / 60_000)} minutes, ` +
        'and the screen this task was planned against is long gone. Ask again when you are ready.'
    }
  }

  // Wake exactly when the quiet period would be up, not on a fixed tick, so
  // the handover back is as quick as it can be.
  return { kind: 'wait', forMs: RESUME_AFTER_MS - quietFor }
}

/** The banner text while the agent is standing aside. */
export function describePause(pausedForMs: number): string {
  const seconds = Math.round(pausedForMs / 1000)
  if (seconds < 5) return 'Paused - you have control'
  if (pausedForMs < MAX_PAUSE_MS / 2) return `Paused - you have control (${seconds}s)`

  const left = Math.max(1, Math.round((MAX_PAUSE_MS - pausedForMs) / 1000))
  return `Paused - you have control. Giving up in ${left}s`
}

/**
 * What the transcript says afterwards, when a run was interrupted but finished.
 *
 * Worth reporting: a task that took two minutes of wall clock because you were
 * typing for ninety seconds of it did not run slowly, and the log should not
 * imply it did.
 */
export function describeYielding(pausedMs: number, times: number): string {
  if (times === 0) return ''
  const seconds = Math.round(pausedMs / 1000)
  return `Stood aside ${times} time${times === 1 ? '' : 's'} while you worked (${seconds}s total).`
}
