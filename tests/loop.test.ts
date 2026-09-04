import { describe, expect, it } from 'vitest'
import type { AgentAction } from '../src/shared/agent'
import {
  actionSignature,
  isStuck,
  loopAdvice,
  REPEAT_LIMIT,
  repeatCount,
  stuckSummary
} from '../src/shared/loop'

const click = (x: number, y: number): AgentAction => ({
  type: 'click',
  x,
  y,
  button: 'left',
  double: false
})
const typeInto = (text: string): AgentAction => ({ type: 'typeInto', x: 500, y: 60, text, submit: true })

describe('actionSignature', () => {
  it('treats a near-identical click as the same attempt', () => {
    // A model aiming at the same button twice will not name the same pixel;
    // counting those as different attempts would defeat the whole check.
    expect(actionSignature(click(500, 300))).toBe(actionSignature(click(508, 296)))
  })

  it('keeps genuinely different targets apart', () => {
    expect(actionSignature(click(500, 300))).not.toBe(actionSignature(click(600, 300)))
  })

  it('ignores case in text and names, which the model varies freely', () => {
    expect(actionSignature(typeInto('ChatGPT'))).toBe(actionSignature(typeInto('chatgpt')))
    expect(actionSignature({ type: 'launch', name: 'Chrome' })).toBe(
      actionSignature({ type: 'launch', name: 'chrome' })
    )
  })

  it('separates typing the same text with and without submitting', () => {
    expect(actionSignature(typeInto('hello'))).not.toBe(
      actionSignature({ type: 'typeInto', x: 500, y: 60, text: 'hello', submit: false })
    )
  })
})

describe('repeatCount', () => {
  it('is zero for nothing', () => {
    expect(repeatCount([])).toBe(0)
  })

  it('counts only the run at the end', () => {
    expect(repeatCount([click(10, 10), click(500, 300), click(500, 300)])).toBe(2)
  })

  it('resets as soon as something different happens', () => {
    expect(repeatCount([click(500, 300), click(500, 300), click(10, 10)])).toBe(1)
  })
})

describe('loopAdvice', () => {
  it('says nothing while the agent is making progress', () => {
    expect(loopAdvice([click(10, 10), click(500, 300)])).toBeNull()
  })

  it('speaks up on the second identical attempt', () => {
    const advice = loopAdvice([click(500, 300), click(500, 300)])
    expect(advice).toContain('STOP')
    expect(advice).toContain('2 times')
  })

  it('names autocomplete when the repeat was typing', () => {
    // The failure that prompted this: typing "chatgpt" into an address bar,
    // the browser completing it to a stale deep link from history, and the
    // agent having no way to work out what happened to it.
    const advice = loopAdvice([typeInto('chatgpt'), typeInto('chatgpt')])
    expect(advice).toContain('autocomplete')
    expect(advice).toContain('https://')
  })

  it('suggests something useful when the repeat was clicking', () => {
    const advice = loopAdvice([click(500, 300), click(500, 300)])
    expect(advice).toContain('covered by something')
  })

  it('always offers giving up honestly as a way out', () => {
    expect(loopAdvice([click(1, 1), click(1, 1)])).toContain('task_done')
  })

  it('tells the model the action worked and the result did not', () => {
    // "ok" means the keystroke was delivered, which is exactly the thing the
    // model keeps mistaking for success.
    expect(loopAdvice([typeInto('x'), typeInto('x')])).toContain('it is the result that is wrong')
  })
})

describe('isStuck', () => {
  it('allows a second try, which is often legitimate', () => {
    // A click that missed by a few pixels, or a page that had not painted yet.
    expect(isStuck([click(500, 300), click(500, 300)])).toBe(false)
  })

  it('gives up on the third', () => {
    expect(isStuck([click(500, 300), click(500, 300), click(500, 300)])).toBe(true)
  })

  it('does not count attempts separated by something else', () => {
    expect(isStuck([click(1, 1), click(500, 300), click(1, 1), click(500, 300)])).toBe(false)
  })
})

describe('stuckSummary', () => {
  it('says what it tried and hands the problem back', () => {
    const summary = stuckSummary([typeInto('chatgpt'), typeInto('chatgpt'), typeInto('chatgpt')])
    expect(summary).toContain(String(REPEAT_LIMIT))
    expect(summary).toContain('Tell me what to do differently')
  })
})
