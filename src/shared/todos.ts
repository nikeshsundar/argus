import type { TodoItem } from './types'

/**
 * The to-do list an agent run works through.
 *
 * "Step 7/50" told the user nothing: 50 is a safety ceiling, not the length
 * of the task. A to-do list is the task, in the milestones a person would
 * name - "Open YouTube, search MrBeast, open the latest video, play it" - so
 * the progress it shows is progress the user can actually judge.
 *
 * Planned once at the start; ticked off as the agent reports which item each
 * action is for, and all at once when the finish is independently confirmed.
 */

/** Past this, a to-do list is a transcript. */
export const MAX_TODOS = 6

/**
 * Reads the planner's reply. Null when there is nothing usable, in which case
 * the run simply goes without a list rather than failing.
 */
export function parseTodos(text: string): string[] | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) return null
  try {
    const raw = JSON.parse(json) as { todos?: unknown }
    if (!Array.isArray(raw.todos)) return null
    const todos = raw.todos
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().replace(/^\d+[.)]\s*/, '').replace(/\.$/, ''))
      .filter(Boolean)
      .map((item) => (item.length > 60 ? `${item.slice(0, 57)}…` : item))
      .slice(0, MAX_TODOS)
    return todos.length ? todos : null
  } catch {
    return null
  }
}

/**
 * Where a run is in its list.
 *
 * `reached` is the highest item number the agent has said it is working on -
 * everything before it is done. It only ever moves forward: an agent that
 * reports item 2 again after item 3 is tidying up, not undoing the progress.
 */
export interface TodoProgress {
  todos: string[]
  reached: number
  finished: boolean
}

export function startTodos(todos: string[]): TodoProgress {
  return { todos, reached: todos.length ? 1 : 0, finished: false }
}

/** Records that the agent is working on item `n` (1-based). */
export function advanceTodos(progress: TodoProgress, n: number | undefined): TodoProgress {
  if (!n || !Number.isFinite(n) || progress.finished) return progress
  const item = Math.min(progress.todos.length, Math.max(1, Math.round(n)))
  return item > progress.reached ? { ...progress, reached: item } : progress
}

/** The finish was confirmed: every item is done. */
export function finishTodos(progress: TodoProgress): TodoProgress {
  return { ...progress, finished: true }
}

export function todoItems(progress: TodoProgress): TodoItem[] {
  return progress.todos.map((text, index) => {
    const n = index + 1
    const state = progress.finished || n < progress.reached ? 'done' : n === progress.reached ? 'active' : 'pending'
    return { text, state }
  })
}

export function todoCount(progress: TodoProgress): { done: number; total: number } {
  return {
    done: todoItems(progress).filter((item) => item.state === 'done').length,
    total: progress.todos.length
  }
}

/** What the agent is told about its own list. */
export function todosForModel(todos: string[]): string {
  if (todos.length === 0) return ''
  return [
    'Your to-do list for this task:',
    ...todos.map((todo, index) => `${index + 1}. ${todo}`),
    'Work through it in order. On every function call, set "todo" to the number of the item that step is for. If an item turns out to be unnecessary, move on to the next.'
  ].join('\n')
}
