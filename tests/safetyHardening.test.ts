import { describe, expect, it } from 'vitest'
import { needsApproval, riskOf } from '../src/shared/safety'
import type { AgentAction } from '../src/shared/agent'

describe('launch risk survives spacing, punctuation and aliases', () => {
  const asks = (name: string): boolean => Boolean(riskOf({ type: 'launch', name }))

  it('catches a shell however the name is written', () => {
    expect(asks('PowerShell')).toBe(true)
    expect(asks('Power Shell')).toBe(true)
    expect(asks('powershell_ise')).toBe(true)
    expect(asks('Windows PowerShell')).toBe(true)
    expect(asks('Command Prompt')).toBe(true)
    expect(asks('Git Bash')).toBe(true)
    expect(asks('Windows Terminal')).toBe(true)
    expect(asks('wt')).toBe(true)
    expect(asks('cmd')).toBe(true)
    expect(asks('Registry Editor')).toBe(true)
    expect(asks('Python 3.12')).toBe(true)
  })

  it('still leaves ordinary apps alone', () => {
    expect(asks('Notepad')).toBe(false)
    expect(asks('Google Chrome')).toBe(false)
    expect(asks('Spotify')).toBe(false)
    expect(asks('Microsoft Word')).toBe(false)
  })
})

describe('the Run dialog is treated as command execution', () => {
  it('asks before Win+R, whatever the modifier is called', () => {
    expect(riskOf({ type: 'keys', keys: ['super', 'r'] })).toBeTruthy()
    expect(riskOf({ type: 'keys', keys: ['win', 'r'] })).toBeTruthy()
    expect(riskOf({ type: 'keys', keys: ['meta', 'r'] })).toBeTruthy()
    expect(needsApproval({ type: 'keys', keys: ['super', 'r'] }, 'sensitive').ask).toBe(true)
  })

  it('does not fire on an ordinary Ctrl+R refresh', () => {
    expect(riskOf({ type: 'keys', keys: ['control', 'r'] })).toBeNull()
  })
})

describe('opening a dangerous scheme is asked about even with a tame purpose', () => {
  const open = (url: string): AgentAction => ({ type: 'openUrl', url })

  it('flags file and protocol-handler URLs', () => {
    expect(needsApproval(open('file:///C:/Windows/System32/cmd.exe'), 'sensitive').ask).toBe(true)
    expect(needsApproval(open('search-ms:query=x'), 'sensitive').ask).toBe(true)
  })

  it('leaves a normal web page alone', () => {
    expect(needsApproval(open('https://docs.new'), 'sensitive').ask).toBe(false)
  })
})
