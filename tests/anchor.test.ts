import { describe, expect, it } from 'vitest'
import { anchorToCursor, DEFAULT_OFFSET, fitsOnDisplay, type Rect } from '../src/shared/anchor'

const SCREEN: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const PANEL = { width: 660, height: 190 }

describe('anchorToCursor', () => {
  it('sits below and to the right of the pointer, where there is usually nothing', () => {
    expect(anchorToCursor({ cursor: { x: 400, y: 300 }, panel: PANEL, bounds: SCREEN })).toEqual({
      x: 400 + DEFAULT_OFFSET.x,
      y: 300 + DEFAULT_OFFSET.y
    })
  })

  it('flips to the left rather than sliding back over the pointer', () => {
    // Sliding would put the panel on top of the control being asked about,
    // which is the one thing it must not cover.
    const at = anchorToCursor({ cursor: { x: 1900, y: 300 }, panel: PANEL, bounds: SCREEN })
    expect(at.x).toBe(1900 - DEFAULT_OFFSET.x - PANEL.width)
    expect(at.x + PANEL.width).toBeLessThanOrEqual(SCREEN.width)
  })

  it('flips above the pointer at the bottom edge', () => {
    const at = anchorToCursor({ cursor: { x: 400, y: 1060 }, panel: PANEL, bounds: SCREEN })
    expect(at.y).toBe(1060 - DEFAULT_OFFSET.y - PANEL.height)
  })

  it('flips both ways at once in the far corner', () => {
    const at = anchorToCursor({ cursor: { x: 1900, y: 1060 }, panel: PANEL, bounds: SCREEN })
    expect(at.x).toBe(1900 - DEFAULT_OFFSET.x - PANEL.width)
    expect(at.y).toBe(1060 - DEFAULT_OFFSET.y - PANEL.height)
  })

  it('clamps instead of flipping when neither side fits', () => {
    // A pointer near the left edge on a narrow display: flipping left would go
    // off screen too, so staying on screen wins.
    const narrow: Rect = { x: 0, y: 0, width: 700, height: 1080 }
    const at = anchorToCursor({ cursor: { x: 300, y: 300 }, panel: PANEL, bounds: narrow })
    expect(at.x).toBeGreaterThanOrEqual(0)
    expect(at.x + PANEL.width).toBeLessThanOrEqual(narrow.width)
  })

  it('keeps the top-left visible when the panel is bigger than the display', () => {
    // Nothing fits. Losing the right-hand edge is survivable; losing the input
    // and the close button is not.
    const tiny: Rect = { x: 0, y: 0, width: 400, height: 120 }
    const at = anchorToCursor({ cursor: { x: 200, y: 60 }, panel: PANEL, bounds: tiny })
    expect(at).toEqual({ x: 0, y: 0 })
  })

  it('works on a second monitor, where coordinates do not start at zero', () => {
    const right: Rect = { x: 1920, y: 0, width: 1920, height: 1080 }
    const at = anchorToCursor({ cursor: { x: 2000, y: 300 }, panel: PANEL, bounds: right })
    expect(at.x).toBe(2000 + DEFAULT_OFFSET.x)
    expect(at.x).toBeGreaterThanOrEqual(right.x)
  })

  it('flips correctly at the right edge of a second monitor', () => {
    const right: Rect = { x: 1920, y: 0, width: 1920, height: 1080 }
    const at = anchorToCursor({ cursor: { x: 3800, y: 300 }, panel: PANEL, bounds: right })
    expect(at.x + PANEL.width).toBeLessThanOrEqual(right.x + right.width)
  })
})

describe('fitsOnDisplay', () => {
  it('accepts a position wholly on the display', () => {
    expect(fitsOnDisplay({ x: 100, y: 100 }, PANEL, SCREEN)).toBe(true)
  })

  it('rejects one that hangs off any edge', () => {
    expect(fitsOnDisplay({ x: 1500, y: 100 }, PANEL, SCREEN)).toBe(false)
    expect(fitsOnDisplay({ x: 100, y: 1000 }, PANEL, SCREEN)).toBe(false)
    expect(fitsOnDisplay({ x: -10, y: 100 }, PANEL, SCREEN)).toBe(false)
  })

  it('judges a second monitor by its own bounds', () => {
    const right: Rect = { x: 1920, y: 0, width: 1920, height: 1080 }
    expect(fitsOnDisplay({ x: 2000, y: 100 }, PANEL, right)).toBe(true)
    expect(fitsOnDisplay({ x: 100, y: 100 }, PANEL, right)).toBe(false)
  })
})
