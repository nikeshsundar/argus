import { toScreenPoint } from '../shared/agent'
import type { TeachResult, TeachStep } from '../shared/teach'
import { watchEscape } from './hotkey'
import { clearTeachStep, hideOverlay, showOverlay, updateTeachStep } from './overlayWindow'
import { createTeachProvider } from './providers'
import { captureActiveDisplay } from './screenshot'
import { waitForUserAction } from './userAction'

/**
 * Generous compared with Agent Mode's 14. A lesson is bounded by the learner's
 * patience, not by an API bill, and a walkthrough legitimately runs long.
 */
const MAX_STEPS = 30

/** Time for the screen to settle after the learner acts, before looking again. */
const SETTLE_MS = 700

/** Within this many pixels of the ghost cursor, a click counts as hitting the target. */
const ON_TARGET_PX = 60

export interface TeachRunOptions {
  topic: string
  signal: AbortSignal
  /** Reports each step to the bar, so the transcript keeps a written copy. */
  onStep?: (step: TeachStep) => void
}

/**
 * Runs one guided lesson.
 *
 * The inverse of `runAgentTask`: the machine is never driven. Each turn draws a
 * ghost cursor over the control and then blocks until the learner does
 * something, so the pace is entirely theirs. What they did is reported back to
 * the model, which sees the resulting screen and decides whether that worked.
 */
export async function runTeachLesson({
  topic,
  signal,
  onStep
}: TeachRunOptions): Promise<TeachResult> {
  const provider = createTeachProvider()
  const session = provider.startLesson(topic, signal)

  const control = new AbortController()
  const abort = (): void => control.abort()
  signal.addEventListener('abort', abort, { once: true })

  let stoppedByUser = false
  const unwatch = watchEscape(() => {
    stoppedByUser = true
    control.abort()
  })

  showOverlay('teach')

  try {
    let lastResult: string | undefined

    for (let index = 1; index <= MAX_STEPS; index++) {
      if (stoppedByUser || control.signal.aborted) {
        return { ok: false, summary: `Lesson stopped after ${index - 1} steps.` }
      }

      // Our own caption would otherwise be in the screenshot, and the model
      // would start explaining its own explanation.
      clearTeachStep()
      hideOverlay()
      const capture = await captureActiveDisplay()
      showOverlay('teach')

      const turn = await session.next(capture.model.png, lastResult)
      if (turn.kind === 'done') return { ok: true, summary: turn.summary }

      const step: TeachStep = { ...turn.step, index }
      const target = toScreenPoint(step.x, step.y, {
        width: capture.info.width,
        height: capture.info.height
      })

      updateTeachStep(step, target)
      onStep?.(step)

      const action = await waitForUserAction(control.signal)
      if (action.kind === 'stopped') {
        return { ok: false, summary: `Lesson stopped after ${index} steps.` }
      }

      lastResult = describeWhatTheyDid(action, target)
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    }

    return {
      ok: true,
      summary: `That is ${MAX_STEPS} steps — ask again to carry on from here.`
    }
  } finally {
    unwatch()
    signal.removeEventListener('abort', abort)
    clearTeachStep()
    hideOverlay()
  }
}

/**
 * Turns the learner's action into something the model can reason about.
 *
 * Distance from the target is the useful signal: a click far away usually means
 * they misread the step, and the model can point again rather than pressing on
 * as though it worked.
 */
function describeWhatTheyDid(
  action: { kind: 'clicked'; x: number; y: number } | { kind: 'advanced' },
  target: { x: number; y: number }
): string {
  if (action.kind === 'advanced') {
    return 'They pressed Space to move on. Check the screenshot for what changed.'
  }

  const distance = Math.round(Math.hypot(action.x - target.x, action.y - target.y))
  return distance <= ON_TARGET_PX
    ? `They clicked the control you pointed at (${distance}px from centre).`
    : `They clicked ${distance}px away from where you pointed, at roughly (${action.x}, ${action.y}) on screen. They may have misread the step - check the screenshot before assuming it worked.`
}
