import { describeAction, type AgentAction, type ScreenSize } from './agent'
import { glideDuration, PACES, type CursorPace } from './cursorPath'

/**
 * A successful Agent Mode run, kept so it can be done again for nothing.
 *
 * Agent Mode costs a model call per step and the better part of a minute per
 * task, against a free tier of twenty calls a day. But the second time someone
 * asks for the same thing, the answer is already known: the exact sequence of
 * actions that worked. Replaying that sequence needs no model at all.
 *
 * What is recorded is the *agent's* actions, not the user's. Watching the user
 * would mean keeping a global keyboard hook running - a keylogger, in an app
 * whose whole promise is that it isn't watching. The agent's own action list is
 * already structured, already semantic, and already known to have worked.
 */
export interface Workflow {
  name: string
  /** The request that produced it, shown when listing and replaying. */
  task: string
  actions: AgentAction[]
  createdAt: number
  runs: number
  /**
   * The display it was recorded on. Coordinates are normalised to 0-1000, so a
   * different resolution is fine; a different *shape* of screen is not, because
   * it moves everything relative to that grid.
   */
  screen: ScreenSize
}

/** Names are matched case-insensitively and by shape, not byte-for-byte. */
export function normaliseName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

export const MAX_NAME_LENGTH = 40

/**
 * Words that already mean something in the bar.
 *
 * A workflow runs by typing its name, so a workflow called "agent" would be
 * unreachable - the mode prefix strips it before anything else sees it. Better
 * to refuse the name than to save something that can never run.
 */
const RESERVED = ['agent', 'ask', 'talk', 'help', 'run', 'save', 'teach me', 'teachme']

/** Why this name can't be used, or null if it can. */
export function nameProblem(raw: string): string | null {
  const name = normaliseName(raw)
  if (!name) return 'Give it a name - "/save morning".'
  if (name.startsWith('/')) {
    return 'A name cannot start with "/" - that is how commands are written.'
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `Keep the name under ${MAX_NAME_LENGTH} characters.`
  }
  if (RESERVED.includes(name)) {
    return `"${name}" already means something in the bar. Pick another name.`
  }
  return null
}

/**
 * The part of a run worth replaying.
 *
 * `done` is the model announcing it has finished, not something to do again.
 * A trailing `wait` is time spent watching for a result that, on a replay,
 * nobody is waiting on.
 */
export function recordable(actions: AgentAction[]): AgentAction[] {
  const kept = actions.filter((action) => action.type !== 'done')
  while (kept.length > 0 && kept[kept.length - 1]!.type === 'wait') kept.pop()
  return kept
}

export type WorkflowCommand =
  | { kind: 'save'; name: string }
  | { kind: 'run'; name: string }
  | { kind: 'delete'; name: string }
  | { kind: 'show'; name: string }
  | { kind: 'list' }
  | { kind: 'clear' }
  | { kind: 'none' }

const SEP = '[\\s=:]+'

const LIST = /^\/workflows\s*$/i
const CLEAR = new RegExp(`^/workflows${SEP}clear\\s*$`, 'i')
const DELETE = new RegExp(`^/workflows${SEP}(?:delete|remove|forget)${SEP}(.+)$`, 'i')
const SHOW = new RegExp(`^/workflows${SEP}(.+)$`, 'i')
const SAVE = new RegExp(`^/save(?:${SEP}(.*))?$`, 'i')
const RUN = new RegExp(`^/run(?:${SEP}(.*))?$`, 'i')

/**
 * The specific forms are tested before the general one, for the same reason
 * "/keys" has to be tested before "/key": otherwise "/workflows clear" reads as
 * a request to show a workflow named "clear", and deletes nothing while looking
 * like it worked.
 */
export function parseWorkflowCommand(input: string): WorkflowCommand {
  const text = input.trim()

  if (LIST.test(text)) return { kind: 'list' }
  if (CLEAR.test(text)) return { kind: 'clear' }

  const remove = DELETE.exec(text)
  if (remove) return { kind: 'delete', name: remove[1]!.trim() }

  const show = SHOW.exec(text)
  if (show) return { kind: 'show', name: show[1]!.trim() }

  const save = SAVE.exec(text)
  if (save) return { kind: 'save', name: (save[1] ?? '').trim() }

  const run = RUN.exec(text)
  if (run) return { kind: 'run', name: (run[1] ?? '').trim() }

  return { kind: 'none' }
}

/**
 * Exact name first, then an unambiguous prefix.
 *
 * An ambiguous prefix matches nothing rather than guessing. Picking one of two
 * candidates would mean typing three letters and watching the machine carry out
 * the wrong task, unattended.
 */
export function findWorkflow(name: string, list: Workflow[]): Workflow | null {
  const wanted = normaliseName(name)
  if (!wanted) return null

  const exact = list.find((flow) => normaliseName(flow.name) === wanted)
  if (exact) return exact

  const prefixed = list.filter((flow) => normaliseName(flow.name).startsWith(wanted))
  return prefixed.length === 1 ? prefixed[0]! : null
}

/** Near misses, so an unknown name can suggest instead of only refusing. */
export function suggestNames(name: string, list: Workflow[]): string[] {
  const wanted = normaliseName(name)
  if (!wanted) return list.map((flow) => flow.name).slice(0, 5)
  return list
    .filter((flow) => {
      const candidate = normaliseName(flow.name)
      return candidate.includes(wanted) || wanted.includes(candidate)
    })
    .map((flow) => flow.name)
    .slice(0, 5)
}

/** Pause after each action, matching what Agent Mode allows for the screen. */
export const REPLAY_SETTLE_MS = 400

/**
 * Roughly how long a replay will take, so the estimate can be shown up front.
 *
 * Worth showing because the number is the whole point of the feature: a task
 * that cost the agent ninety seconds of deliberation replays in a few.
 */
export function estimateMs(
  actions: AgentAction[],
  pace: CursorPace,
  screen: ScreenSize
): number {
  const { typeDelayMs } = PACES[pace]
  // Starts where the pointer usually sits at the beginning of a run.
  let at = { x: screen.width / 2, y: screen.height / 2 }
  let total = 0

  for (const action of actions) {
    if ('x' in action && 'y' in action) {
      const to = {
        x: (action.x / 1000) * screen.width,
        y: (action.y / 1000) * screen.height
      }
      total += glideDuration(Math.hypot(to.x - at.x, to.y - at.y), pace)
      at = to
    }
    if (action.type === 'type' || action.type === 'typeInto') {
      total += action.text.length * typeDelayMs
    }
    if (action.type === 'wait') total += action.seconds * 1000
    // Launching a program waits for its first window, over in inputSim.
    if (action.type === 'launch' || action.type === 'openUrl') total += 1500
    total += REPLAY_SETTLE_MS
  }

  return Math.round(total)
}

/** "about 4s", "about 1m 20s" - an estimate, phrased as one. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `about ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `about ${minutes}m` : `about ${minutes}m ${rest}s`
}

/** One line per workflow, for the list. */
export function describeWorkflow(flow: Workflow): string {
  const steps = `${flow.actions.length} step${flow.actions.length === 1 ? '' : 's'}`
  const used = flow.runs === 0 ? 'never run' : `run ${flow.runs} times`
  return `${flow.name} - ${steps}, ${used} - "${flow.task}"`
}

/** Numbered steps, for showing what a replay is about to do. */
export function previewLines(flow: Workflow): string[] {
  return flow.actions.map((action, index) => `${index + 1}. ${describeAction(action)}`)
}

/**
 * True when the screen has changed shape since recording.
 *
 * Replay is blind: it clicks the coordinates that worked last time, with no
 * screenshot and no model to check them against. Normalised coordinates survive
 * a resolution change, because everything scales together. They do not survive
 * an aspect ratio change - going from 16:9 to ultrawide moves every control
 * relative to the grid, and a blind click then lands on whatever now occupies
 * that spot. That is the one case worth refusing outright.
 */
export function screenDrifted(recorded: ScreenSize, current: ScreenSize): boolean {
  if (!recorded.width || !recorded.height || !current.width || !current.height) return false
  const before = recorded.width / recorded.height
  const now = current.width / current.height
  return Math.abs(before - now) / before > 0.02
}
