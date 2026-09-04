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
    // "/mo" also reaches "Screen memory" by label; the command named by what
    // was typed is the one Enter has to pick.
    expect(filterOptions('/mo')[0]?.id).toBe('model')
    expect(filterOptions('/cur').map((option) => option.id)).toEqual(['cursor'])
  })

  it('matches on the visible label as well as the command name', () => {
    expect(filterOptions('/past').map((option) => option.id)).toEqual(['history'])
  })

  it('carries only slash commands, now that the presets are gone', () => {
    expect(OPTIONS.every((option) => option.insert.startsWith('/'))).toBe(true)
  })

  it('offers the workflow commands', () => {
    // "/run" also matches "Save the last Agent run" by label; ranking keeps
    // the command itself on top.
    expect(filterOptions('/run')[0]?.id).toBe('run')
    expect(filterOptions('/work')[0]?.id).toBe('workflows')
  })

  it('puts the command someone typed above one that merely mentions it', () => {
    // "/save" matches the save command by name and "Saved workflows" by label.
    // The first row is the one Enter picks, so the exact command has to win.
    expect(filterOptions('/save')[0]?.id).toBe('save')
    expect(filterOptions('/save').map((option) => option.id)).toContain('workflows')
  })

  it('offers the screen memory commands', () => {
    expect(filterOptions('/rec')[0]?.id).toBe('recall')
    expect(filterOptions('/mem')[0]?.id).toBe('memory')
  })

  it('gets out of the way for anything that is not a command', () => {
    for (const text of ['what is this error', 'open instagram', 'agent open chrome']) {
      expect(filterOptions(text), text).toEqual([])
    }
  })
})
