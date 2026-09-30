import { describe, expect, it } from 'vitest'
import { planBatch, type AgentAction } from '../src/shared/agent'
import { needsApproval, parseSafetyCommand, riskOf } from '../src/shared/safety'
import { realLineBreaks } from '../src/shared/agent'

const click = (purpose?: string, sensitive?: boolean): AgentAction => ({
  type: 'click',
  x: 500,
  y: 500,
  button: 'left',
  double: false,
  ...(purpose ? { purpose } : {}),
  ...(sensitive ? { sensitive } : {})
})

describe('riskOf', () => {
  it('trusts the model when it flags a step as sensitive', () => {
    expect(riskOf(click('Click the blue button', true))).toBe('Click the blue button')
  })

  it('catches a risky step the model forgot to flag, from its own description', () => {
    expect(riskOf(click('Click Send'))).toBe('Click Send')
    expect(riskOf(click('Delete the selected files'))).toBeTruthy()
    expect(riskOf(click('Click Place order'))).toBeTruthy()
    expect(riskOf(click('Pay now'))).toBeTruthy()
  })

  it('leaves routine steps alone, so approval stays worth reading', () => {
    expect(riskOf(click('Open the email from John'))).toBeNull()
    expect(riskOf(click('Click the Sent folder'))).toBeNull()
    expect(riskOf(click('Click inside the document body'))).toBeNull()
    expect(riskOf(click('Open the Compose window'))).toBeNull()
  })

  it('catches send and delete shortcuts that have no visible button', () => {
    expect(riskOf({ type: 'keys', keys: ['control', 'enter'] })).toBeTruthy()
    expect(riskOf({ type: 'keys', keys: ['Ctrl', 'Enter'] })).toBeTruthy()
    expect(riskOf({ type: 'keys', keys: ['shift', 'delete'] })).toBeTruthy()
    expect(riskOf({ type: 'keys', keys: ['control', 'a'] })).toBeNull()
  })

  it('asks about a bare Enter, which can press a focused Send button', () => {
    expect(riskOf({ type: 'keys', keys: ['enter'] })).toBeTruthy()
    expect(riskOf({ type: 'keys', keys: ['enter'], purpose: 'Start a new line' })).toBeNull()
  })

  it('asks before opening tools that can change the system', () => {
    expect(riskOf({ type: 'launch', name: 'PowerShell' })).toBeTruthy()
    expect(riskOf({ type: 'launch', name: 'Registry Editor' })).toBeTruthy()
    expect(riskOf({ type: 'launch', name: 'Notepad' })).toBeNull()
  })

  it('asks before pages that take money or credentials', () => {
    expect(riskOf({ type: 'openUrl', url: 'https://shop.example.com/checkout' })).toBeTruthy()
    expect(riskOf({ type: 'openUrl', url: 'https://docs.new' })).toBeNull()
  })

  it('lets addresses and searches submit freely', () => {
    const go = (text: string): AgentAction => ({ type: 'typeInto', x: 1, y: 1, text, submit: true })
    expect(riskOf(go('https://gmail.com'))).toBeNull()
    expect(riskOf(go('weather in chennai'))).toBeNull()
  })
})

describe('needsApproval', () => {
  it('never asks when safety is off', () => {
    expect(needsApproval(click('Click Send'), 'off').ask).toBe(false)
  })

  it('asks about everything in strict mode', () => {
    expect(needsApproval(click('Click inside the page'), 'every').ask).toBe(true)
  })

  it('never asks to finish', () => {
    expect(needsApproval({ type: 'done', summary: 'x' }, 'every').ask).toBe(false)
  })
})

describe('planBatch with risky steps', () => {
  it('runs nothing after a step that needed approval', () => {
    const plan = planBatch([click('Click Send'), click('Click Inbox')])
    expect(plan.actions).toHaveLength(1)
    expect(plan.presets[1]).toMatch(/approval/)
  })
})

describe('parseSafetyCommand', () => {
  it('reads the modes', () => {
    expect(parseSafetyCommand('/safety')).toEqual({ kind: 'status' })
    expect(parseSafetyCommand('/safety strict')).toEqual({ kind: 'set', mode: 'every' })
    expect(parseSafetyCommand('/safety on')).toEqual({ kind: 'set', mode: 'sensitive' })
    expect(parseSafetyCommand('/safety off')).toEqual({ kind: 'set', mode: 'off' })
    expect(parseSafetyCommand('/safety maybe')).toEqual({ kind: 'bad', raw: 'maybe' })
    expect(parseSafetyCommand('/save x')).toEqual({ kind: 'none' })
  })
})

describe('only the committing step is asked about', () => {
  it('never asks about typing, however the model labelled it', () => {
    expect(
      riskOf({ type: 'type', text: 'Hi there', purpose: 'Type the email to send', sensitive: true })
    ).toBeNull()
    expect(
      riskOf({ type: 'keys', keys: ['control', 'a'], purpose: 'Select all text', sensitive: true })
    ).toBeNull()
  })

  it('still asks about the click that sends it', () => {
    expect(riskOf(click('Click Send'))).toBe('Click Send')
  })
})

describe('realLineBreaks', () => {
  it('turns a literal backslash-n into a line break', () => {
    expect(realLineBreaks('Hi,\n\nI am Argus')).toBe('Hi,\n\nI am Argus')
  })

  it('leaves text that already has real line breaks alone', () => {
    expect(realLineBreaks('printf("a\n");\nreturn 0;')).toBe('printf("a\n");\nreturn 0;')
  })
})
