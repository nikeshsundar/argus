import { screen } from 'electron'
import { describeAction, type ScreenSize } from '../shared/agent'
import type { AgentStepEvent } from '../shared/types'
import { REPLAY_SETTLE_MS, type Workflow } from '../shared/workflow'
import { watchEscape } from './hotkey'
import { executeAction } from './inputSim'
import { hideOverlay, showOverlay, updateOverlay } from './overlayWindow'
import { asAgent, watchUser } from './userPresence'
import { createYielding } from './yield'

export interface ReplayResult {
  ok: boolean
  summary: string
}

export interface ReplayOptions {
  workflow: Workflow
  signal: AbortSignal
  onStep?: (event: AgentStepEvent) => void
}

/**
 * The size of the display the pointer is on, in physical pixels.
 *
 * The same number `captureActiveDisplay` reports, arrived at without taking a
 * screenshot - a replay has no use for the pixels, only for the geometry that
 * turns a normalised coordinate into a place on the glass.
 */
export function activeScreenSize(): ScreenSize {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor)
  }
}

/**
 * Replays a saved run: no screenshots, no model, no deliberation.
 *
 * The difference from `runAgentTask` is that nothing here decides anything. It
 * is the same overlay and the same Escape handling, driving a list that was
 * settled the first time round. That is what makes it free and quick, and also
 * what makes it blind - see `screenDrifted` for the one case worth refusing.
 */
export async function replayWorkflow({
  workflow,
  signal,
  onStep
}: ReplayOptions): Promise<ReplayResult> {
  const size = activeScreenSize()
  const total = workflow.actions.length

  let stoppedByUser = false
  // Escape has to reach into the action already running, not merely be noticed
  // before the next one: a glide at demo pace is over a second long.
  const control = new AbortController()
  const abort = (): void => control.abort()
  signal.addEventListener('abort', abort, { once: true })
  const unwatch = watchEscape(() => {
    stoppedByUser = true
    control.abort()
  })

  showOverlay()

  // A replay drives the pointer exactly as the agent does, so it owes the user
  // the same courtesy: stand aside the moment they touch anything.
  const unwatchUser = watchUser()
  const yielding = createYielding(control.signal)

  try {
    for (const [index, action] of workflow.actions.entries()) {
      if (stoppedByUser || signal.aborted) {
        return { ok: false, summary: `Stopped after ${index} of ${total} steps.` }
      }

      const clear = await yielding.wait()
      if (!clear.ok) return { ok: false, summary: clear.reason }
      if (stoppedByUser || signal.aborted) {
        return { ok: false, summary: `Stopped after ${index} of ${total} steps.` }
      }

      const event: AgentStepEvent = {
        description: describeAction(action),
        index: index + 1,
        max: total
      }
      updateOverlay(event)
      onStep?.(event)

      try {
        await asAgent(() => executeAction(action, size, control.signal))
      } catch (error) {
        // A live agent would be told what went wrong and try something else.
        // A replay has nobody to tell, so carrying on would mean typing the
        // rest of the sequence into whatever is on screen instead.
        const why = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          summary: `Stopped at step ${index + 1} (${describeAction(action)}): ${why}`
        }
      }

      await new Promise((resolve) => setTimeout(resolve, REPLAY_SETTLE_MS))
    }

    if (stoppedByUser || signal.aborted) {
      return { ok: false, summary: `Stopped after ${total} of ${total} steps.` }
    }

    const stoodAside = yielding.summary()
    const done = `Replayed "${workflow.name}" — ${total} steps, no model needed.`
    return { ok: true, summary: stoodAside ? `${done}

${stoodAside}` : done }
  } finally {
    unwatch()
    unwatchUser()
    signal.removeEventListener('abort', abort)
    hideOverlay()
  }
}
