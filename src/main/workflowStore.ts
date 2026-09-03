import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { normaliseName, type Workflow } from '../shared/workflow'

/**
 * Saved workflows live in their own file rather than in settings.json.
 *
 * Settings is configuration the user typed; this is captured data that grows
 * without bound. Keeping them apart means a corrupt or oversized workflow file
 * can be discarded on its own, without taking the user's API keys with it.
 */
function workflowPath(): string {
  return join(app.getPath('userData'), 'workflows.json')
}

/** Enough for anyone, and a bound on a file we read on every list. */
const MAX_WORKFLOWS = 100

let cache: Workflow[] | null = null

/**
 * Rejects anything that would crash the replay loop later.
 *
 * The file is plain JSON in a directory the user can open, so it can be
 * hand-edited or half-written by a crash. A malformed entry is dropped rather
 * than trusted - the alternative is a `TypeError` thrown mid-replay, with the
 * pointer already somewhere on the real desktop.
 */
function isWorkflow(value: unknown): value is Workflow {
  if (!value || typeof value !== 'object') return false
  const flow = value as Partial<Workflow>
  return (
    typeof flow.name === 'string' &&
    flow.name.trim().length > 0 &&
    typeof flow.task === 'string' &&
    Array.isArray(flow.actions) &&
    flow.actions.every((action) => Boolean(action) && typeof action.type === 'string')
  )
}

function heal(flow: Workflow): Workflow {
  return {
    ...flow,
    createdAt: typeof flow.createdAt === 'number' ? flow.createdAt : Date.now(),
    runs: typeof flow.runs === 'number' && flow.runs >= 0 ? flow.runs : 0,
    screen:
      flow.screen && typeof flow.screen.width === 'number' && typeof flow.screen.height === 'number'
        ? flow.screen
        : { width: 0, height: 0 }
  }
}

export function listWorkflows(): Workflow[] {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(readFileSync(workflowPath(), 'utf8'))
    cache = Array.isArray(parsed) ? parsed.filter(isWorkflow).map(heal) : []
  } catch {
    // No file yet, or an unreadable one. An empty list is the right answer to
    // both: nothing has been saved that we can offer to replay.
    cache = []
  }
  return cache
}

function persist(list: Workflow[]): void {
  cache = list
  const file = workflowPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(list, null, 2), 'utf8')
}

/** Saves under this name, replacing any existing workflow that has it. */
export function saveWorkflow(flow: Workflow): void {
  const wanted = normaliseName(flow.name)
  const rest = listWorkflows().filter((existing) => normaliseName(existing.name) !== wanted)
  // Newest first: the list is read far more often than it is written, and the
  // thing just saved is the thing most likely to be wanted.
  persist([flow, ...rest].slice(0, MAX_WORKFLOWS))
}

export function deleteWorkflow(name: string): boolean {
  const wanted = normaliseName(name)
  const before = listWorkflows()
  const after = before.filter((flow) => normaliseName(flow.name) !== wanted)
  if (after.length === before.length) return false
  persist(after)
  return true
}

export function clearWorkflows(): number {
  const count = listWorkflows().length
  persist([])
  return count
}

/** Records that a workflow ran, so the list can show what actually gets used. */
export function noteRun(name: string): void {
  const wanted = normaliseName(name)
  persist(
    listWorkflows().map((flow) =>
      normaliseName(flow.name) === wanted ? { ...flow, runs: flow.runs + 1 } : flow
    )
  )
}
