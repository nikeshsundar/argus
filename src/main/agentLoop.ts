import { describeAction, type AgentAction } from '../shared/agent'
import type { AgentStepEvent } from '../shared/types'
import { loadAppIndex } from './appIndex'
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
  const installedApps = (await loadAppIndex()).map((entry) => entry.name).slice(0, 200)
  const session = provider.startTask(task, signal, installedApps)

  let stoppedByUser = false
  // A glide can be a second long at demo pace, so Escape has to reach into the
  // action that is already running - not just be noticed before the next one.
  const control = new AbortController()
  const abort = (): void => control.abort()
  signal.addEventListener('abort', abort, { once: true })
  const unwatch = watchEscape(() => {
    stoppedByUser = true
    control.abort()
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

      lastResult = await perform(action, capture, control.signal)
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    }

    return {
      ok: false,
      summary: `Hit the ${MAX_STEPS}-step limit without finishing. Try a smaller task.`
    }
  } finally {
    unwatch()
    signal.removeEventListener('abort', abort)
    hideOverlay()
  }
}

/** Runs one action, converting a failure into feedback the model can use. */
async function perform(
  action: AgentAction,
  capture: Awaited<ReturnType<typeof captureActiveDisplay>>,
  signal: AbortSignal
): Promise<string> {
  try {
    return await executeAction(
      action,
      {
        width: capture.info.width,
        height: capture.info.height
      },
      signal
    )
  } catch (error) {
    return `failed: ${error instanceof Error ? error.message : String(error)}`
  }
}
