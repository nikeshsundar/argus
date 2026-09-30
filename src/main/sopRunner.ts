import { rememberRun, type AgentRunRecord } from '../shared/agentHistory'
import {
  createKeyGate,
  sopReport,
  SOP_MAX_WRITERS,
  type PreparedBlock,
  type SopOutcome,
  type SopStep
} from '../shared/sop'
import type { AgentStepEvent } from '../shared/types'
import { runAgentTask } from './agentLoop'
import { configuredKeys } from './geminiKeys'
import { watchEscape } from './hotkey'
import { hideOverlay, noteOverlay, showOverlay } from './overlayWindow'
import { planSop, sopModels, writeSopStep } from './providers/geminiSop'
import { ProviderUnavailableError } from './providers/types'
import { loadSettings } from './settingsStore'

export interface SopRunResult {
  ok: boolean
  summary: string
}

/** What a finished step hands to the steps that need it. */
interface StepOutput {
  ok: boolean
  text: string
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  settled: boolean
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const deferred = {
    promise: new Promise<T>((done) => (resolve = done)),
    settled: false
  } as Deferred<T>
  deferred.resolve = (value: T): void => {
    if (deferred.settled) return
    deferred.settled = true
    resolve(value)
  }
  return deferred
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Runs a long SOP: many writers at once, one operator on screen.
 *
 * Every write step starts the moment what it needs is ready, each on its own
 * API key. Screen steps run in order through the ordinary agent - with its
 * approvals, limits and completion check - and start straight away, pausing
 * only when they reach text a writer has not finished yet. So the operator
 * is opening Gmail while the email is still being written.
 *
 * If the SOP cannot be split, it runs as one ordinary agent task: splitting
 * is an optimisation, never a reason for the job not to happen.
 */
export async function runSop(options: {
  sop: string
  signal: AbortSignal
  onStep?: (event: AgentStepEvent) => void
}): Promise<SopRunResult> {
  const keys = configuredKeys()
  if (keys.length === 0) {
    throw new ProviderUnavailableError('SOP mode needs a Gemini key — type "/key <your-key>".')
  }

  const startedAt = Date.now()
  const control = new AbortController()
  const stop = (): void => control.abort()
  options.signal.addEventListener('abort', stop, { once: true })
  // Escape stops the whole SOP - writers included - not just the screen step
  // that happens to be running.
  const unwatch = watchEscape(stop)

  const say = (text: string): void => {
    showOverlay()
    noteOverlay(text)
    options.onStep?.({ description: text, index: 0, max: 0 })
  }

  try {
    const models = sopModels(loadSettings())
    say('Planning your SOP…')

    const plan = await planSop(options.sop, keys[0]!, models, control.signal).catch(() => null)
    if (control.signal.aborted) return { ok: false, summary: 'Stopped before the SOP started.' }

    if (!plan) {
      say('Could not split this SOP — running it as one task')
      hideOverlay()
      const result = await runAgentTask({
        task: options.sop,
        signal: control.signal,
        ...(options.onStep ? { onStep: options.onStep } : {})
      })
      return result
    }

    const writers = plan.steps.filter((step) => step.kind === 'write')
    const lanes = Math.min(keys.length, SOP_MAX_WRITERS)
    say(
      writers.length > 0
        ? `Plan ready: ${plan.steps.length} steps — ${writers.length} writer${writers.length === 1 ? '' : 's'} starting on ${Math.min(lanes, writers.length)} key${Math.min(lanes, writers.length) === 1 ? '' : 's'}`
        : `Plan ready: ${plan.steps.length} steps`
    )

    const byId = new Map(plan.steps.map((step) => [step.id, step]))
    const results = new Map(plan.steps.map((step) => [step.id, defer<StepOutput>()]))
    const outcomes = new Map<string, SopOutcome>()
    const spans: { start: number; end: number }[] = []
    const gate = createKeyGate(lanes)
    const inputsOf = (step: SopStep): Promise<StepOutput[]> =>
      Promise.all(step.needs.map((id) => results.get(id)!.promise))

    const settle = (step: SopStep, outcome: SopOutcome, output: StepOutput): void => {
      outcomes.set(step.id, outcome)
      results.get(step.id)!.resolve(output)
    }

    // ---- writers: all at once, one key each ---------------------------------
    const writing = writers.map(async (step) => {
      const inputs = await inputsOf(step)
      if (control.signal.aborted) {
        return settle(step, { status: 'stopped', detail: 'stopped' }, { ok: false, text: '' })
      }
      if (inputs.some((input) => !input.ok)) {
        return settle(
          step,
          { status: 'not run', detail: 'an earlier step it needed did not finish' },
          { ok: false, text: '' }
        )
      }

      const slot = await gate.acquire()
      const start = Date.now()
      try {
        if (control.signal.aborted) throw new Error('stopped')
        const text = await writeSopStep({
          step,
          goal: plan.goal,
          inputs: step.needs.map((id, index) => ({
            title: byId.get(id)!.title,
            text: inputs[index]!.text
          })),
          key: keys[slot]!,
          models,
          signal: control.signal
        })
        const end = Date.now()
        spans.push({ start, end })
        settle(
          step,
          { status: 'done', detail: `written in ${seconds(end - start)} on key ${slot + 1}`, text, key: slot + 1 },
          { ok: true, text }
        )
        const finished = writers.filter((one) => outcomes.get(one.id)?.status === 'done').length
        options.onStep?.({
          description: `Writer ${slot + 1} finished "${step.title}" (${finished}/${writers.length} texts ready)`,
          index: 0,
          max: 0
        })
      } catch (error) {
        const stopped = control.signal.aborted
        settle(
          step,
          {
            status: stopped ? 'stopped' : 'failed',
            detail: stopped ? 'stopped' : error instanceof Error ? error.message : String(error)
          },
          { ok: false, text: '' }
        )
      } finally {
        gate.release(slot)
      }
    })

    // ---- operator: screen steps, in order ----------------------------------
    let runs: AgentRunRecord[] = []
    let halted = false
    const screenSteps = plan.steps.filter((step) => step.kind === 'screen')

    for (const [position, step] of screenSteps.entries()) {
      if (halted || control.signal.aborted) {
        settle(
          step,
          control.signal.aborted
            ? { status: 'stopped', detail: 'stopped' }
            : { status: 'not run', detail: 'an earlier step did not finish' },
          { ok: false, text: '' }
        )
        continue
      }

      const waitingOn = step.needs.filter((id) => !results.get(id)!.settled)
      if (waitingOn.length > 0) {
        const ready = writers.filter((one) => results.get(one.id)!.settled).length
        say(`Waiting for writers — ${ready}/${writers.length} texts ready…`)
      }
      const inputs = await inputsOf(step)
      if (control.signal.aborted) {
        settle(step, { status: 'stopped', detail: 'stopped' }, { ok: false, text: '' })
        halted = true
        continue
      }
      if (inputs.some((input) => !input.ok)) {
        settle(
          step,
          { status: 'not run', detail: 'the text it needed could not be written' },
          { ok: false, text: '' }
        )
        halted = true
        continue
      }

      const blocks: PreparedBlock[] = []
      const context: string[] = []
      step.needs.forEach((id, index) => {
        const source = byId.get(id)!
        if (source.kind === 'write') {
          blocks.push({ id: source.id, title: source.title, text: inputs[index]!.text })
        } else {
          context.push(`${source.title}: ${inputs[index]!.text}`)
        }
      })

      const task = [
        step.instruction,
        ...(context.length ? ['', 'What earlier steps found:', ...context] : []),
        '',
        `(Step ${position + 1} of ${screenSteps.length} on screen, part of the SOP "${plan.goal}". Do only this step - the other steps are handled separately.)`
      ].join('\n')

      say(`SOP step ${position + 1}/${screenSteps.length}: ${step.title}`)
      let result: { ok: boolean; summary: string }
      try {
        result = await runAgentTask({
          task,
          signal: control.signal,
          history: runs,
          blocks,
          ...(options.onStep
            ? {
                onStep: (event: AgentStepEvent) =>
                  options.onStep!({
                    ...event,
                    description: `[${position + 1}/${screenSteps.length}] ${event.description}`
                  })
              }
            : {})
        })
      } catch (error) {
        result = { ok: false, summary: error instanceof Error ? error.message : String(error) }
      }

      runs = rememberRun(runs, { task: step.title, summary: result.summary, ok: result.ok, at: Date.now() })
      settle(
        step,
        {
          status: result.ok ? 'done' : control.signal.aborted ? 'stopped' : 'failed',
          detail: result.summary.split('\n')[0]!.slice(0, 160)
        },
        { ok: result.ok, text: result.summary }
      )
      // A failed screen step usually leaves the screen somewhere the next one
      // does not expect. Stopping is safer than clicking on regardless.
      if (!result.ok) halted = true
    }

    // Nothing left on screen needs the remaining writers if the run halted.
    if (halted) control.abort()
    await Promise.all(writing)

    const report = sopReport(plan, outcomes, spans, Math.min(lanes, Math.max(1, writers.length)), Date.now() - startedAt)
    const allDone = plan.steps.every((step) => outcomes.get(step.id)?.status === 'done')
    return { ok: allDone, summary: report }
  } finally {
    unwatch()
    options.signal.removeEventListener('abort', stop)
    hideOverlay()
  }
}
