import { describe, expect, it } from 'vitest'
import { filterOptions, OPTIONS } from '../src/renderer/src/options'

describe('filterOptions', () => {
  it('lists every option for empty input', () => {
    expect(filterOptions('')).toHaveLength(OPTIONS.length)
  })

  it('filters commands as the user types after a slash', () => {
    const ids = filterOptions('/mo').map((option) => option.id)
    expect(ids).toEqual(['model'])
  })

  it('only lists command rows for a slash query', () => {
    expect(filterOptions('/').every((option) => option.insert.startsWith('/'))).toBe(true)
  })

  it('narrows to the agent row once a task is being typed', () => {
    expect(filterOptions('agent open chrome').map((option) => option.id)).toEqual(['agent'])
  })

  it('gets out of the way for a plain question', () => {
    expect(filterOptions('what is this error')).toEqual([])
  })
})
