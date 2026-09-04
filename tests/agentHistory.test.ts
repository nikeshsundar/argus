import { describe, expect, it } from 'vitest'
import {
  AGENT_MEMORY_MS,
  formatAgentHistory,
  MAX_REMEMBERED_RUNS,
  recentRuns,
  rememberRun,
  type AgentRunRecord
} from '../src/shared/agentHistory'

const NOW = 1_700_000_000_000
const minute = 60_000

const run = (task: string, agoMs = 0, over: Partial<AgentRunRecord> = {}): AgentRunRecord => ({
  task,
  summary: `did ${task}`,
  ok: true,
  at: NOW - agoMs,
  ...over
})

describe('rememberRun', () => {
  it('keeps the newest run last, which is the order the recap reads in', () => {
    const history = rememberRun([run('open gmail', minute)], run('open in edge'), NOW)
    expect(history.map((one) => one.task)).toEqual(['open gmail', 'open in edge'])
  })

  it('carries only the last few, so the prompt does not grow into a task list', () => {
    let history: AgentRunRecord[] = []
    for (const task of ['one', 'two', 'three', 'four', 'five']) {
      history = rememberRun(history, run(task), NOW)
    }
    expect(history).toHaveLength(MAX_REMEMBERED_RUNS)
    expect(history.map((one) => one.task)).toEqual(['three', 'four', 'five'])
  })

  it('drops runs that have aged out as it adds the new one', () => {
    const stale = run('yesterday', AGENT_MEMORY_MS + minute)
    const history = rememberRun([stale], run('open gmail'), NOW)
    expect(history.map((one) => one.task)).toEqual(['open gmail'])
  })

  it('remembers a run that failed - that is the one worth carrying', () => {
    // "It opened Gmail but you were not signed in" is exactly the context the
    // next task needs; dropping failures would lose the useful half.
    const history = rememberRun([], run('open gmail', 0, { ok: false }), NOW)
    expect(history[0]?.ok).toBe(false)
  })
})

describe('recentRuns', () => {
  it('forgets anything older than the window', () => {
    const history = [run('old', AGENT_MEMORY_MS + 1000), run('new', minute)]
    expect(recentRuns(history, NOW).map((one) => one.task)).toEqual(['new'])
  })
})

describe('formatAgentHistory', () => {
  it('says nothing at all when there is nothing to say', () => {
    // An empty block must not become an empty heading in the prompt.
    expect(formatAgentHistory([], NOW)).toBe('')
    expect(formatAgentHistory([run('old', AGENT_MEMORY_MS * 2)], NOW)).toBe('')
  })

  it('recaps what was asked and what came of it', () => {
    const text = formatAgentHistory(
      [
        run('open gmail and summarise my unread mail', 4 * minute, {
          ok: false,
          summary: 'Opened Gmail in Chrome, but you are not signed in.'
        })
      ],
      NOW
    )
    expect(text).toContain('4 minutes ago')
    expect(text).toContain('open gmail and summarise my unread mail')
    expect(text).toContain('Did not finish')
    expect(text).toContain('not signed in')
  })

  it('marks a completed run differently from an abandoned one', () => {
    expect(formatAgentHistory([run('open notepad')], NOW)).toContain('Result')
  })

  it('tells the model when to ignore the history', () => {
    // Without this the recap contaminates an unrelated next task, which is a
    // worse failure than having no memory: the agent goes off doing something
    // nobody asked for a second time.
    const text = formatAgentHistory([run('open gmail', minute)], NOW)
    expect(text).toContain('If it stands on its own')
    expect(text).toContain('completely new task')
  })

  it('reads "just now" rather than "0 minutes ago"', () => {
    expect(formatAgentHistory([run('open gmail', 5_000)], NOW)).toContain('just now')
  })
})
