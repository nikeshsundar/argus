import { describe, expect, it } from 'vitest'
import { filterOptions, OPTIONS } from '../src/renderer/src/options'

describe('filterOptions', () => {
  it('shows nothing until a slash is typed', () => {
    // The default state is a bare input. Anything floating over the screen is
    // covering the thing the user is asking about.
    expect(filterOptions('')).toEqual([])
    expect(filterOptions('   ')).toEqual([])
  })

  it('opens the full palette on a bare slash', () => {
    expect(filterOptions('/')).toHaveLength(OPTIONS.length)
  })

  it('filters commands as the user types after a slash', () => {
    expect(filterOptions('/mo').map((option) => option.id)).toEqual(['model'])
    expect(filterOptions('/cur').map((option) => option.id)).toEqual(['cursor'])
  })

  it('matches on the visible label as well as the command name', () => {
    expect(filterOptions('/past').map((option) => option.id)).toEqual(['history'])
  })

  it('carries only slash commands, now that the presets are gone', () => {
    expect(OPTIONS.every((option) => option.insert.startsWith('/'))).toBe(true)
  })

  it('gets out of the way for anything that is not a command', () => {
    for (const text of ['what is this error', 'open instagram', 'agent open chrome']) {
      expect(filterOptions(text), text).toEqual([])
    }
  })
})
