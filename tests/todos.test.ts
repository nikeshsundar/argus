import { describe, expect, it } from 'vitest'
import {
  advanceTodos,
  finishTodos,
  parseTodos,
  startTodos,
  todoCount,
  todoItems,
  todosForModel,
  MAX_TODOS
} from '../src/shared/todos'
import { safetyBadge } from '../src/shared/safety'

const YOUTUBE = ['Open YouTube', 'Search for MrBeast', 'Find his latest video', 'Play it']

describe('parseTodos', () => {
  it('reads the list, tidying numbering and full stops', () => {
    expect(parseTodos('{"todos": ["1. Open YouTube.", " Search for MrBeast ", "Play it"]}')).toEqual([
      'Open YouTube',
      'Search for MrBeast',
      'Play it'
    ])
  })

  it('caps the length and survives junk', () => {
    const many = JSON.stringify({ todos: Array.from({ length: 20 }, (_, n) => `Step ${n}`) })
    expect(parseTodos(many)).toHaveLength(MAX_TODOS)
    expect(parseTodos('{"todos": []}')).toBeNull()
    expect(parseTodos('{"todos": "open youtube"}')).toBeNull()
    expect(parseTodos('no json here')).toBeNull()
  })
})

describe('todo progress', () => {
  it('starts on the first item', () => {
    expect(todoItems(startTodos(YOUTUBE)).map((item) => item.state)).toEqual([
      'active',
      'pending',
      'pending',
      'pending'
    ])
  })

  it('ticks everything before the item the agent is working on', () => {
    let progress = startTodos(YOUTUBE)
    progress = advanceTodos(progress, 3)
    expect(todoItems(progress).map((item) => item.state)).toEqual(['done', 'done', 'active', 'pending'])
    expect(todoCount(progress)).toEqual({ done: 2, total: 4 })
  })

  it('never goes backwards, and ignores nonsense', () => {
    let progress = advanceTodos(startTodos(YOUTUBE), 3)
    progress = advanceTodos(progress, 1) // tidying up an earlier item
    progress = advanceTodos(progress, undefined)
    progress = advanceTodos(progress, Number.NaN)
    expect(progress.reached).toBe(3)
    expect(advanceTodos(startTodos(YOUTUBE), 99).reached).toBe(4) // clamped to the list
  })

  it('ticks everything once the finish is confirmed', () => {
    const progress = finishTodos(advanceTodos(startTodos(YOUTUBE), 2))
    expect(todoCount(progress)).toEqual({ done: 4, total: 4 })
    expect(todoItems(progress).every((item) => item.state === 'done')).toBe(true)
  })

  it('is empty, not broken, when there is no list', () => {
    expect(todoItems(startTodos([]))).toEqual([])
    expect(todoCount(startTodos([]))).toEqual({ done: 0, total: 0 })
    expect(todosForModel([])).toBe('')
  })

  it('tells the agent the list and to report against it', () => {
    const text = todosForModel(YOUTUBE)
    expect(text).toContain('1. Open YouTube')
    expect(text).toContain('4. Play it')
    expect(text).toContain('"todo"')
  })
})

describe('safetyBadge', () => {
  it('fits in the banner', () => {
    expect(safetyBadge('sensitive')).toBe('Safety on')
    expect(safetyBadge('every')).toBe('Safety: strict')
    expect(safetyBadge('off')).toBe('Safety OFF')
  })
})
