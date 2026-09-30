import { describeAction, type AgentAction } from '../shared/agent'
import type { AgentRunRecord } from '../shared/agentHistory'
import { isStuck, loopAdvice, stuckSummary } from '../shared/loop'
import type { PreparedBlock } from '../shared/sop'
import type { AgentStepEvent } from '../shared/types'
import { loadAppIndex } from './appIndex'
import { watchEscape } from './hotkey'
import { executeAction } from './inputSim'
import { gateAction } from './approval'
import { riskOf, safetyBadge } from '../shared/safety'
import { checkLimits, hasLimits, limitsForModel } from '../shared/limits'
import {
  advanceTodos,
  finishTodos,
  startTodos,
  todoCount,
  todoItems,
  todosForModel
} from '../shared/todos'
import { activeWindowTitle } from './activeWindow'
import { loadSettings } from './settingsStore'
import {
  hideOverlay,
  noteOverlay,
  showOverlay,
  updateOverlay,
  updateTodos
} from './overlayWindow'
import { planTodos } from './providers/geminiPlan'
import { createAgentProvider } from './providers'
import { captureActiveDisplay } from './screenshot'
import { asAgent, watchUser } from './userPresence'
import { createYielding } from './yield'
import { presentGhost } from './cursor'
import { configuredKeys } from './geminiKeys'
import { verifyCompletion } from './providers/geminiVerify'
import { MAX_REJECTIONS, type Verdict } from '../shared/verify'

/**
 * Safety ceiling, not the task length. The model calls task_done when the SOP
 * is complete; this only prevents a confused model from running forever.
 */
const MAX_STEPS = 50
/**
 * Extra pause after an action before looking again.
 *
 * Small, because it is not the only wait: the screen grab that follows takes
 * about 400ms on its own, so the screen already gets most of a second to
 * settle before the model sees it. The old 500 was stacked on top of that and
 * bought nothing but a slower agent - a dozen steps of it is six seconds.
 */
const SETTLE_MS = 60

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
  /** Text an SOP writer already prepared, pasted by reference. */
  blocks?: PreparedBlock[]
  /**
   * Plan a to-do list first (default). Off for one-step runs, where a list
   * would be a single line that cost a request to write.
   */
  plan?: boolean
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
  history = [],
  blocks = [],
  plan = true
}: AgentRunOptions): Promise<AgentRunResult> {
  const provider = createAgentProvider()
  const installedApps = (await loadAppIndex()).map((entry) => entry.name).slice(0, 200)
  // Read once: limits changed mid-run would move the fence under a task that
  // was planned inside it.
  const settings = loadSettings()
  const limits = settings.limits
  const startedAt = Date.now()
  /** Steps the limits refused. Past a few, the task cannot be done inside them. */
  let blockedCount = 0
  /** Times a finish was sent back by the checker. */
  let rejections = 0

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
  void presentGhost()

  // The run's to-do list, and how far through it the agent is. The banner
  // shows this instead of "step 7/50" - fifty is a safety ceiling, not the
  // length of the task, so a count against it told the user nothing.
  let todos: string[] = []
  let progress = startTodos(todos)
  const emit = (description: string): void => {
    const event: AgentStepEvent = {
      description,
      index: 0,
      max: 0,
      ...(todos.length ? { todo: todoCount(progress) } : {})
    }
    updateOverlay(event)
    onStep?.(event)
  }
  const showTodos = (): void => updateTodos(todos.length ? todoItems(progress) : null)

  // Said up front, every run, so the user can see the protection is live
  // before the agent touches anything - not discover it was off afterwards.
  const badge = hasLimits(limits)
    ? `${safetyBadge(settings.approvalMode)} · limits on`
    : safetyBadge(settings.approvalMode)
  updateTodos(null)

  if (plan) {
    emit(`${badge} — planning the steps…`)
    const key = configuredKeys()[0]
    todos = key
      ? ((await planTodos({
          task,
          apiKey: key,
          fallbackModels: ['gemini-flash-lite-latest', settings.agentModel],
          signal: control.signal
        })) ?? [])
      : []
    progress = startTodos(todos)
    showTodos()
  }
  emit(todos.length ? `${badge} — ${todos.length} to-do${todos.length === 1 ? '' : 's'}: ${todos[0]}` : badge)

  // The list goes to the agent too, so the plan it is measured against is
  // the plan it follows.
  const session = provider.startTask(
    todos.length ? `${task}\n\n${todosForModel(todos)}` : task,
    signal,
    installedApps,
    history,
    limitsForModel(limits),
    blocks
  )
  const performed: AgentAction[] = []
  /** Corrections the user made from approval cards, shown on later cards. */
  const changes: string[] = []
  const describedTask = (): string =>
    changes.length ? `${task} — then: ${changes.join('; ')}` : task
  /**
   * Everything tried, working or not. `performed` holds only what succeeded,
   * and a loop is made of actions that succeed perfectly while achieving
   * nothing - so it cannot be spotted from that list.
   */
  const attempted: AgentAction[] = []

  // The machine is the user's first. Touching the mouse or keyboard stands the
  // agent down between steps; going quiet picks it back up.
  const unwatchUser = watchUser()
  const yielding = createYielding(control.signal)

  try {
    let lastResults: string[] = []

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

      const batch = await session.next(capture.model.png, lastResults)
      lastResults = []

      // The provider only ever returns task_done on its own, so a finish is
      // always a verdict on a screen the model has actually looked at.
      const finish = batch.length === 1 && batch[0]!.type === 'done' ? batch[0]! : null
      if (finish && finish.type === 'done') {
        // Not taken on the agent's word. An independent check looks at the
        // same screen the agent just did and asks whether it proves the claim.
        noteOverlay('Double-checking the result…')
        const verdict = await checkFinish(task, finish.summary, finish.evidence, capture.model.png, control.signal)
        if (verdict && !verdict.complete) {
          rejections++
          if (rejections <= MAX_REJECTIONS) {
            emit(`Not done yet — ${verdict.problem}`)
            lastResults = [
              `task_done was REJECTED by an independent check of the screenshot: ${verdict.problem}. ` +
                'The task is NOT finished. Look at the screen, fix what is wrong, and only call task_done when the screen itself proves it.'
            ]
            continue
          }
          // Still unconvinced after the agent's retries. Say so plainly,
          // rather than hand the user a success the screen does not show.
          return {
            ok: false,
            summary: `${finish.summary}

Not confirmed: ${verdict.problem}. Please check the screen.`,
            actions: performed
          }
        }

        // Confirmed, so every item is done - ticked on screen for a moment
        // before the overlay goes, so the list is seen to complete.
        progress = finishTodos(progress)
        showTodos()
        emit(finish.summary)
        if (todos.length) await new Promise((resolve) => setTimeout(resolve, 900))
        const stoodAside = yielding.summary()
        return {
          ok: true,
          summary: stoodAside ? `${finish.summary}\n\n${stoodAside}` : finish.summary,
          actions: performed
        }
      }

      for (const [index, action] of batch.entries()) {
        if (stoppedByUser || signal.aborted) {
          return { ok: false, summary: `Stopped after ${step - 1} steps.`, actions: performed }
        }

        // The agent says which to-do this action is for; anything before it
        // is done. Only ever forward - revisiting an item is tidying up.
        const before = progress.reached
        progress = advanceTodos(progress, action.todo)
        if (progress.reached !== before) showTodos()
        emit(
          batch.length > 1
            ? `${describeAction(action)} (${index + 1}/${batch.length})`
            : describeAction(action)
        )

        // Budgets first: a task over its limit stops before doing anything more.
        if (limits.maxSteps !== null && attempted.length >= limits.maxSteps) {
          return {
            ok: false,
            summary: `Stopped at your limit of ${limits.maxSteps} steps. Everything so far is left as it is on screen — raise it with "/limits steps <n>".`,
            actions: performed
          }
        }
        if (limits.maxMinutes !== null && Date.now() - startedAt > limits.maxMinutes * 60_000) {
          return {
            ok: false,
            summary: `Stopped at your limit of ${limits.maxMinutes} min. Everything so far is left as it is on screen — raise it with "/limits minutes <n>".`,
            actions: performed
          }
        }

        // The fence. Checked against what Windows says has focus, not what the
        // model believes it is looking at, and never offered for approval:
        // a limit the user can be talked past in the moment is not a limit.
        const outside = checkLimits(action, limits, { windowTitle: await activeWindowTitle() })
        if (outside) {
          blockedCount++
          emit(`Blocked: ${outside}`)
          if (blockedCount >= 3) {
            return {
              ok: false,
              summary: `Stopped: the task kept needing steps outside your limits — last one: ${outside}. Change them with "/limits" if you meant to allow it.`,
              actions: performed
            }
          }
          lastResults.push(
            `BLOCKED by the user's limits and NOT run: ${outside}. This is enforced by the system. Do not try to get around it; ` +
              'find a way inside the limits, or call task_done and say which limit is in the way.'
          )
          break
        }

        // Irreversible steps wait for the user. A refusal ends the task there:
        // the model is not given the chance to look for another way round.
        const decision = await gateAction(action, describedTask(), control.signal)
        if (decision.kind === 'stop') {
          return {
            ok: false,
            summary: `Stopped before "${decision.title}" — you did not approve it. Everything up to that step is done and left as it is on screen.`,
            actions: performed
          }
        }
        if (decision.kind === 'change') {
          // Not run. The user's correction goes back to the model as the
          // result of this step, and the rest of the batch is dropped - it was
          // planned for the version the user just turned down.
          changes.push(decision.note)
          lastResults.push(
            `NOT DONE - the user reviewed this step ("${decision.title}") and asked for a change first: "${decision.note}". ` +
              'This is an instruction from the user. Make that change on screen, check it in the next screenshot, then take this step again - they will be asked to approve it again.'
          )
          break
        }
        if (stoppedByUser || signal.aborted) {
          return { ok: false, summary: `Stopped after ${step - 1} steps.`, actions: performed }
        }

        attempted.push(action)
        let result = await asAgent(() => perform(action, capture, control.signal))

        // An approved send is done. Without saying so, a model that sees the
        // compose window still closing can decide it did not work and send
        // the same email a second time.
        if (riskOf(action) && !result.startsWith('failed') && result !== 'cancelled') {
          result = `${result}. This irreversible step has been carried out - do NOT repeat it. If the screen does not show it yet, wait and check; never do it a second time.`
        }
        if (!result.startsWith('failed') && result !== 'cancelled') performed.push(action)

        // Going in circles. Repeating an action that "worked" is the one failure
        // the model cannot see: it is told "ok" every time, and a fresh
        // screenshot it has already misread once is not enough to change its
        // mind. Saying so plainly is.
        if (isStuck(attempted)) {
          return { ok: false, summary: stuckSummary(attempted), actions: performed }
        }
        const advice = loopAdvice(attempted)
        if (advice) result = `${result}. ${advice}`
        lastResults.push(result)

        // The rest of the batch was planned against a screen where this
        // worked. It did not, so they are left for the model to reconsider.
        if (result.startsWith('failed') || result === 'cancelled') break

        // Between batched actions, give the UI a beat to react - a click has
        // to focus the field before the text after it can land there.
        if (index < batch.length - 1) await new Promise((resolve) => setTimeout(resolve, 150))
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    }

    return {
      ok: false,
      summary: `Reached the ${MAX_STEPS}-step safety limit without finishing. The SOP may need a smaller task or a clearer stopping condition.`,
      actions: performed
    }
  } finally {
    unwatch()
    unwatchUser()
    signal.removeEventListener('abort', abort)
    updateTodos(null)
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

/** The model that checks finishes. Lite: its own free quota, and fast. */
const CHECKER_MODEL = 'gemini-2.5-flash-lite'

/**
 * Asks the checker about a finish. Null when it could not be asked - no key,
 * no quota, Google down - in which case the run ends as the agent said:
 * failing a task because the second opinion was unavailable would be wrong.
 */
async function checkFinish(
  task: string,
  summary: string,
  evidence: string | undefined,
  screenshot: Buffer,
  signal: AbortSignal
): Promise<Verdict | null> {
  const key = configuredKeys()[0]
  if (!key) return null
  try {
    return await verifyCompletion({
      apiKey: key,
      model: CHECKER_MODEL,
      fallbackModels: ['gemini-flash-lite-latest', loadSettings().agentModel],
      task,
      summary,
      ...(evidence ? { evidence } : {}),
      screenshot,
      signal
    })
  } catch {
    return null
  }
}
