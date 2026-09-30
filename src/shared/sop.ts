/**
 * SOP mode: one long procedure, split between many writers and one operator.
 *
 * The PC has one mouse, one keyboard and one focused window, so the screen
 * work in an SOP can only ever happen one step at a time - several agents
 * driving the same desktop at once would type into each other's windows. But
 * most of the TIME in a long SOP is not screen work. It is writing: the email
 * bodies, the post, the report. That needs no screen, so it can be split
 * across every API key the user has and done all at once, while the operator
 * is already on screen opening the apps it will be pasted into.
 *
 * This file holds the parts that are pure logic - reading the plan, handing
 * out keys, measuring what the parallel work saved, writing the report - so
 * they can be tested without a model or a desktop.
 */

export type SopKind = 'write' | 'screen'

export interface SopStep {
  /** "s1", "s2" ... - reassigned in order, whatever the planner called them. */
  id: string
  title: string
  kind: SopKind
  instruction: string
  /** Earlier steps whose output this one uses. Always earlier, so no cycles. */
  needs: string[]
  /** Write steps only: needs current public facts, so the writer may search. */
  web: boolean
}

export interface SopPlan {
  goal: string
  steps: SopStep[]
}

/** Text a writer produced, handed to the operator to paste by reference. */
export interface PreparedBlock {
  id: string
  title: string
  text: string
}

/** Past this, an SOP is several SOPs and should be run as such. */
export const SOP_MAX_STEPS = 12

/** Writers at once. Past six, a free-tier user is out of keys anyway. */
export const SOP_MAX_WRITERS = 6

/**
 * Reads the planner's JSON into a plan that is safe to run.
 *
 * The planner is a model, so nothing it returns is trusted as-is: steps
 * without instructions are dropped, ids are renumbered, and a dependency is
 * kept only if it points at an EARLIER step. That last rule is what makes a
 * deadlock impossible - screen steps run in order, writers only ever wait on
 * something that comes before them, so everything waited on is either done
 * or already running.
 *
 * Null when there is nothing usable, so the caller can fall back to running
 * the SOP as one ordinary task.
 */
export function parseSopPlan(text: string): SopPlan | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) return null

  let raw: { goal?: unknown; steps?: unknown }
  try {
    raw = JSON.parse(json) as typeof raw
  } catch {
    return null
  }
  if (!Array.isArray(raw.steps)) return null

  const renamed = new Map<string, string>()
  const steps: SopStep[] = []

  for (const item of raw.steps as Record<string, unknown>[]) {
    if (steps.length >= SOP_MAX_STEPS) break
    if (!item || typeof item !== 'object') continue

    const instruction = typeof item['instruction'] === 'string' ? item['instruction'].trim() : ''
    if (!instruction) continue

    const id = `s${steps.length + 1}`
    const original = typeof item['id'] === 'string' && item['id'].trim() ? item['id'].trim() : id
    // A repeated id would make "needs" ambiguous; the first one keeps it.
    if (!renamed.has(original)) renamed.set(original, id)

    const kind: SopKind = item['kind'] === 'write' ? 'write' : 'screen'
    const title =
      typeof item['title'] === 'string' && item['title'].trim()
        ? item['title'].trim().slice(0, 80)
        : instruction.slice(0, 60)

    const earlier = new Set(steps.map((step) => step.id))
    const needs = (Array.isArray(item['needs']) ? item['needs'] : [])
      .filter((need): need is string => typeof need === 'string')
      .map((need) => renamed.get(need.trim()))
      .filter((need): need is string => Boolean(need && earlier.has(need)))

    steps.push({
      id,
      title,
      kind,
      instruction,
      needs: [...new Set(needs)],
      web: kind === 'write' && item['web'] === true
    })
  }

  if (steps.length === 0) return null
  const goal = typeof raw.goal === 'string' && raw.goal.trim() ? raw.goal.trim() : steps[0]!.title
  return { goal, steps }
}

/**
 * Hands out API keys to writers, one writer per key at a time.
 *
 * Free-tier quota is per Google Cloud project, so a key per writer is what
 * turns five keys into five times the throughput. A sixth writer waits for
 * the first key to come free instead of piling onto a busy one.
 */
export function createKeyGate(count: number): {
  acquire(): Promise<number>
  release(slot: number): void
  readonly busy: number
} {
  const free = Array.from({ length: Math.max(1, count) }, (_, index) => index)
  const waiting: ((slot: number) => void)[] = []
  let busy = 0

  return {
    acquire(): Promise<number> {
      const slot = free.shift()
      if (slot !== undefined) {
        busy++
        return Promise.resolve(slot)
      }
      return new Promise((resolve) => waiting.push((given) => {
        busy++
        resolve(given)
      }))
    },
    release(slot: number): void {
      busy--
      const next = waiting.shift()
      if (next) next(slot)
      else free.unshift(slot)
    },
    get busy(): number {
      return busy
    }
  }
}

/**
 * What running the writers side by side actually saved.
 *
 * `workMs` is how long they would have taken one after another; `wallMs` is
 * how long they took together. Only writing is counted - the overlap with
 * screen work saves more, but claiming it would mean guessing.
 */
export function parallelSavings(spans: { start: number; end: number }[]): {
  workMs: number
  wallMs: number
  savedMs: number
} {
  if (spans.length === 0) return { workMs: 0, wallMs: 0, savedMs: 0 }
  const workMs = spans.reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0)
  const wallMs =
    Math.max(...spans.map((span) => span.end)) - Math.min(...spans.map((span) => span.start))
  return { workMs, wallMs, savedMs: Math.max(0, workMs - wallMs) }
}

export type SopStatus = 'done' | 'failed' | 'stopped' | 'not run'

export interface SopOutcome {
  status: SopStatus
  /** One line: how it went, or why not. */
  detail: string
  /** Write steps: the text produced. */
  text?: string
  /** Write steps: which key wrote it, counting from 1. */
  key?: number
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

const MARK: Record<SopStatus, string> = { done: '✓', failed: '✗', stopped: '■', 'not run': '–' }

/**
 * The merged progress report shown when the SOP ends.
 *
 * Every step appears, whatever happened to it, so nothing silently
 * disappears. Texts that were pasted somewhere are only previewed - they are
 * on screen. Texts nothing used are printed in full, since the report is the
 * only place they exist.
 */
export function sopReport(
  plan: SopPlan,
  outcomes: Map<string, SopOutcome>,
  spans: { start: number; end: number }[],
  keysUsed: number,
  totalMs: number
): string {
  const done = plan.steps.filter((step) => outcomes.get(step.id)?.status === 'done').length
  const used = new Set(
    plan.steps.filter((step) => step.kind === 'screen').flatMap((step) => step.needs)
  )

  const lines = [`SOP: ${plan.goal}`, `${done} of ${plan.steps.length} steps done in ${seconds(totalMs)}.`, '']

  plan.steps.forEach((step, index) => {
    const outcome = outcomes.get(step.id) ?? { status: 'not run', detail: '' }
    const who = step.kind === 'write' ? 'writer' : 'screen'
    lines.push(`${MARK[outcome.status]} ${index + 1}. ${step.title} (${who})${outcome.detail ? ` — ${outcome.detail}` : ''}`)
  })

  const { workMs, wallMs, savedMs } = parallelSavings(spans)
  if (spans.length > 1 && savedMs > 0) {
    lines.push(
      '',
      `Parallel writing: ${spans.length} texts on ${keysUsed} key${keysUsed === 1 ? '' : 's'} — ${seconds(workMs)} of writing finished in ${seconds(wallMs)} (saved ~${seconds(savedMs)}).`
    )
  }

  const unplaced = plan.steps.filter(
    (step) => step.kind === 'write' && !used.has(step.id) && outcomes.get(step.id)?.text
  )
  for (const step of unplaced) {
    lines.push('', `— ${step.title} —`, outcomes.get(step.id)!.text!)
  }

  return lines.join('\n')
}

/** Reads "/sop ..." or "sop: ...". Null when the text is not an SOP request. */
export function parseSopCommand(input: string): { sop: string } | null {
  const match = /^\/?sop(?:\s*:\s*|\s+|$)([\s\S]*)$/i.exec(input.trim())
  if (!match) return null
  return { sop: match[1]!.trim() }
}
