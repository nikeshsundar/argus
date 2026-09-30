import { describe, expect, it } from 'vitest'
import { describeAction, MAX_BATCH, planBatch, toScreenPoint } from '../src/shared/agent'

const SCREEN = { width: 1920, height: 1080 }

describe('toScreenPoint', () => {
  it('maps the normalised centre to the middle of the screen', () => {
    expect(toScreenPoint(500, 500, SCREEN)).toEqual({ x: 960, y: 540 })
  })

  it('maps the corners to real edge pixels', () => {
    expect(toScreenPoint(0, 0, SCREEN)).toEqual({ x: 0, y: 0 })
    expect(toScreenPoint(1000, 1000, SCREEN)).toEqual({ x: 1919, y: 1079 })
  })

  it('clamps coordinates outside the grid', () => {
    expect(toScreenPoint(-50, 5000, SCREEN)).toEqual({ x: 0, y: 1079 })
  })

  it('scales to the display it is given', () => {
    expect(toScreenPoint(500, 500, { width: 2560, height: 1440 })).toEqual({ x: 1280, y: 720 })
  })
})

describe('describeAction', () => {
  it('names the button for right clicks', () => {
    expect(
      describeAction({ type: 'click', x: 10, y: 20, button: 'right', double: false })
    ).toContain('Right-click')
  })

  it('truncates long typed text', () => {
    const description = describeAction({ type: 'type', text: 'x'.repeat(80) })
    expect(description.length).toBeLessThan(60)
    expect(description).toContain('…')
  })

  it('renders key combinations', () => {
    expect(describeAction({ type: 'keys', keys: ['control', 'a'] })).toBe('Press control+a')
  })
})

describe('typeInto', () => {
  it('reads as one step covering click, type and submit', () => {
    expect(
      describeAction({ type: 'typeInto', x: 500, y: 90, text: 'github.com', submit: true })
    ).toBe('Type "github.com" at 500,90 and press Enter')
  })

  it('says so when it will not submit', () => {
    expect(
      describeAction({ type: 'typeInto', x: 500, y: 90, text: 'draft', submit: false })
    ).toBe('Type "draft" at 500,90')
  })

  it('truncates a long value rather than filling the overlay banner', () => {
    const described = describeAction({
      type: 'typeInto',
      x: 1,
      y: 2,
      text: 'x'.repeat(200),
      submit: false
    })
    expect(described.length).toBeLessThan(60)
    expect(described).toContain('…')
  })
})

describe('planBatch', () => {
  const click = { type: 'click', x: 500, y: 500, button: 'left', double: false } as const
  const type = { type: 'type', text: 'hello' } as const
  const done = { type: 'done', summary: 'finished' } as const

  it('runs a single action as it is', () => {
    expect(planBatch([click])).toEqual({ actions: [click], presets: [undefined] })
  })

  it('refuses task_done in the same turn as work nobody has checked', () => {
    const plan = planBatch([click, type, done])
    expect(plan.actions).toEqual([click, type])
    expect(plan.presets[2]).toMatch(/on its own/)
  })

  it('stops the batch after anything that changes the whole screen', () => {
    const open = { type: 'openUrl', url: 'https://docs.new' } as const
    const plan = planBatch([open, click, type])
    expect(plan.actions).toEqual([open])
    expect(plan.presets[1]).toMatch(/changed the screen/)
    expect(plan.presets[2]).toMatch(/changed the screen/)
  })

  it('caps how much runs from one screenshot', () => {
    const plan = planBatch(Array.from({ length: MAX_BATCH + 2 }, () => click))
    expect(plan.actions).toHaveLength(MAX_BATCH)
    expect(plan.presets.filter(Boolean)).toHaveLength(2)
  })
})
