import { describe, expect, it } from 'vitest'
import { parseMode } from '../src/shared/types'

describe('parseMode', () => {
  it('reads a question as talk mode', () => {
    expect(parseMode('what is on my screen')).toEqual({
      mode: 'talk',
      prompt: 'what is on my screen'
    })
  })

  it('defaults to agent mode when the wording decides nothing', () => {
    expect(parseMode('the file i just downloaded')).toEqual({
      mode: 'agent',
      prompt: 'the file i just downloaded'
    })
  })

  it('detects agent mode and strips the trigger word', () => {
    expect(parseMode('agent open chrome and go to github')).toEqual({
      mode: 'agent',
      prompt: 'open chrome and go to github'
    })
  })

  it.each(['agent, open chrome', 'agent: open chrome', '  Agent   open chrome'])(
    'accepts trigger punctuation and casing in %j',
    (input) => {
      expect(parseMode(input)).toEqual({ mode: 'agent', prompt: 'open chrome' })
    }
  )

  it('does not treat words merely starting with "agent" as the trigger', () => {
    // Not the trigger, so the prompt keeps the word - and with no question
    // signal in it, the default applies.
    expect(parseMode('agentic workflows explained')).toEqual({
      mode: 'agent',
      prompt: 'agentic workflows explained'
    })
  })

  it('returns an empty prompt when only the trigger is given', () => {
    expect(parseMode('agent')).toEqual({ mode: 'agent', prompt: '' })
  })
})
