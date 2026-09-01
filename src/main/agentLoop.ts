import { describeAction, type AgentAction } from '../shared/agent'
import type { AgentStepEvent } from '../shared/types'
import { watchEscape } from './hotkey'
import { executeAction } from './inputSim'
import { hideOverlay, showOverlay, updateOverlay } from './overlayWindow'
import { createAgentProvider } from './providers'
import { captureActiveDisplay } from './screenshot'

/** Hard ceiling on actions per task, so a confused model can't grind forever. */
const MAX_STEPS = 14
/** Time for the screen to settle after an action before looking again. */
const SETTLE_MS = 500

export interface AgentRunOptions {
  task: string
  signal: AbortSignal
  /** Reports each step to the bar as well as the overlay. */
  onStep?: (event: AgentStepEvent) => void
}

export interface AgentRunResult {
  ok: boolean
  summary: string
}

/**
 * Runs one Agent Mode task: look at the screen, take one action, look again.
 *
 * Three things can stop it - the model calling task_done, the step ceiling, or
 * the user pressing Escape. The overlay is on screen the entire time.
 */
export async function runAgentTask({
  task,
  signal,
  onStep
}: AgentRunOptions): Promise<AgentRunResult> {
  const provider = createAgentProvider()
  const session = provider.startTask(task, signal)

  let stoppedByUser = false
  const unwatch = watchEscape(() => {
    stoppedByUser = true
  })

  showOverlay()

  try {
    let lastResult: string | undefined

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (stoppedByUser || signal.aborted) {
        return { ok: false, summary: `Stopped after ${step - 1} steps.` }
      }

      // The overlay would otherwise sit in the screenshot and cover the very
      // UI the model needs to read.
      hideOverlay()
      const capture = await captureActiveDisplay()
      showOverlay()

      const action = await session.next(capture.model.png, lastResult)

      const event: AgentStepEvent = {
        description: describeAction(action),
        index: step,
        max: MAX_STEPS
      }
      updateOverlay(event)
      onStep?.(event)

      if (action.type === 'done') {
        return { ok: true, summary: action.summary }
      }

      if (stoppedByUser || signal.aborted) {
        return { ok: false, summary: `Stopped after ${step - 1} steps.` }
      }

      lastResult = await perform(action, capture)
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    }

    return {
      ok: false,
      summary: `Hit the ${MAX_STEPS}-step limit without finishing. Try a smaller task.`
    }
  } finally {
    unwatch()
    hideOverlay()
  }
}

/** Runs one action, converting a failure into feedback the model can use. */
async function perform(
  action: AgentAction,
  capture: Awaited<ReturnType<typeof captureActiveDisplay>>
): Promise<string> {
  try {
    await executeAction(action, {
      width: capture.info.width,
      height: capture.info.height
    })
    return 'ok'
  } catch (error) {
    return `failed: ${error instanceof Error ? error.message : String(error)}`
  }
}
