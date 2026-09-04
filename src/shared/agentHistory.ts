/**
 * What Agent Mode remembers between tasks.
 *
 * Each run used to start from nothing: `startTask` built a fresh conversation
 * whose entire content was the words just typed. So a follow-up like "open it
 * in Edge instead" arrived with no idea what "it" was, and the agent did the
 * literal thing - opened Edge - and correctly called task_done, having
 * completed everything it had been told about.
 *
 * The fix is not to guess which requests are follow-ups. It is to hand the
 * model the last few tasks and how they went, and let it read the new
 * instruction in that light, exactly as a person would.
 */

/** One finished Agent run, as the next one gets to hear about it. */
export interface AgentRunRecord {
  task: string
  /** What the agent reported at the end - including why it gave up. */
  summary: string
  ok: boolean
  at: number
}

/**
 * How many previous runs to carry.
 *
 * Three is enough for "open gmail" → "open it in edge" → "now summarise it"
 * without the prompt growing into a second task list. Older than that and the
 * model starts answering the wrong question.
 */
export const MAX_REMEMBERED_RUNS = 3

/**
 * How long a run stays relevant.
 *
 * A task from twenty minutes ago is not what "try it again" means, and
 * silently continuing it would be worse than having no memory at all. Fifteen
 * minutes covers a session of related work and expires on its own.
 */
export const AGENT_MEMORY_MS = 15 * 60_000

/** Adds a finished run, dropping whatever has aged out or fallen off the end. */
export function rememberRun(
  history: AgentRunRecord[],
  record: AgentRunRecord,
  now: number = record.at
): AgentRunRecord[] {
  const fresh = [...history, record].filter((run) => now - run.at <= AGENT_MEMORY_MS)
  return fresh.slice(-MAX_REMEMBERED_RUNS)
}

/** Drops anything too old to be what the user is referring to. */
export function recentRuns(history: AgentRunRecord[], now: number): AgentRunRecord[] {
  return history.filter((run) => now - run.at <= AGENT_MEMORY_MS)
}

/** "4 minutes ago" / "just now" - vague on purpose, it only sets an order. */
function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
}

/**
 * The context block prepended to a new task.
 *
 * Written as a plain recap rather than a transcript: the model needs to know
 * what was asked and what came of it, not to replay a dozen function calls it
 * can no longer see the screenshots for.
 */
export function formatAgentHistory(history: AgentRunRecord[], now: number): string {
  const runs = recentRuns(history, now)
  if (runs.length === 0) return ''

  const lines = runs.map((run) => {
    const outcome = run.ok ? 'Result' : 'Did not finish'
    return `- ${ago(now - run.at)} you were asked: "${run.task}"\n  ${outcome}: ${run.summary}`
  })

  return [
    'Earlier in this session, on this same machine:',
    ...lines,
    '',
    'Read the new task in that light. If it only makes sense as a continuation - a fragment like "open it in Edge instead", "try again", "now do the rest", or a request that never names what it acts on - then it is the earlier task carried on, and you should finish what was actually being asked for, not just the words in the new line. If it stands on its own, ignore all of the above and treat it as a completely new task.'
  ].join('\n')
}
