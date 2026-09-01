import { describe, expect, it } from 'vitest'
import { describeAction, toScreenPoint } from '../src/shared/agent'

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
