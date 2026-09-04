import { describeAction, type AgentAction } from '../shared/agent'
import type { AgentRunRecord } from '../shared/agentHistory'
import type { AgentStepEvent } from '../shared/types'
import { loadAppIndex } from './appIndex'
import { watchEscape } from './hotkey'
import { executeAction } from './inputSim'
import { hideOverlay, showOverlay, updateOverlay } from './overlayWindow'
import { createAgentProvider } from './providers'
import { captureActiveDisplay } from './screenshot'
import { asAgent, watchUser } from './userPresence'
import { createYielding } from './yield'

/** Hard ceiling on actions per task, so a confused model can't grind forever. */
const MAX_STEPS = 14
/** Time for the screen to settle after an action before looking again. */
const SETTLE_MS = 500

export interface AgentRunOptions {
  task: string
  signal: AbortSignal
  /** Reports each step to the bar as well as the overlay. */
  onStep?: (event: AgentStepEvent) => void
  /**
   * The last few tasks and how they went. Without it every run starts from
   * nothing, and "open it in Edge instead" is read as the whole job.
   */
  history?: AgentRunRecord[]
}

export interface AgentRunResult {
  ok: boolean
  summary: string
  /**
   * Every action that ran and worked, in order, so a successful task can be
   * saved and replayed without paying for the thinking a second time. Failed
   * and cancelled actions are left out: a replay has no model to recover with,
   * so repeating a step that did not work would only put the pointer somewhere
   * the rest of the sequence does not expect.
   */
  actions: AgentAction[]
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
  onStep,
  history = []
}: AgentRunOptions): Promise<AgentRunResult> {
  const provider = createAgentProvider()
  const installedApps = (await loadAppIndex()).map((entry) => entry.name).slice(0, 200)
  const session = provider.startTask(task, signal, installedApps, history)

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
  const performed: AgentAction[] = []

  // The machine is the user's first. Touching the mouse or keyboard stands the
  // agent down between steps; going quiet picks it back up.
  const unwatchUser = watchUser()
  const yielding = createYielding(control.signal)

  try {
    let lastResult: string | undefined

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (stoppedByUser || signal.aborted) {
        return { ok: false, summary: `Stopped after ${step - 1} steps.`, actions: performed }
      }

      // Before the screenshot, not after: capturing while someone is still
      // typing hands the model a screen that no longer exists by the time it
      // decides what to do with it.
      const clear = await yielding.wait()
      if (!clear.ok) return { ok: false, summary: clear.reason, actions: performed }
      if (stoppedByUser || signal.aborted) {
        return { ok: false, summary: `Stopped after ${step - 1} steps.`, actions: performed }
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
        const stoodAside = yielding.summary()
        return {
          ok: true,
          summary: stoodAside ? `${action.summary}

${stoodAside}` : action.summary,
          actions: performed
        }
      }

      if (stoppedByUser || signal.aborted) {
        return { ok: false, summary: `Stopped after ${step - 1} steps.`, actions: performed }
      }

      lastResult = await asAgent(() => perform(action, capture, control.signal))
      if (lastResult === 'ok' || lastResult.startsWith('launched') || lastResult.startsWith('opened')) {
        performed.push(action)
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    }

    return {
      ok: false,
      summary: `Hit the ${MAX_STEPS}-step limit without finishing. Try a smaller task.`,
      actions: performed
    }
  } finally {
    unwatch()
    unwatchUser()
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
