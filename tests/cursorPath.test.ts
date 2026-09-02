import { describe, expect, it } from 'vitest'
import { easeInOutCubic, glideDuration, pointAt } from '../src/shared/cursorPath'

describe('easeInOutCubic', () => {
  it('pins both ends of the glide', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
  })

  it('is exactly halfway at the midpoint', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10)
  })

  it('starts slower than it finishes the first half', () => {
    // The point of the easing: the pointer accelerates rather than jerking off
    // the mark, so the first tenth covers far less than a tenth of the way.
    expect(easeInOutCubic(0.1)).toBeLessThan(0.05)
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.95)
  })

  it('clamps input outside 0-1 rather than overshooting', () => {
    expect(easeInOutCubic(-1)).toBe(0)
    expect(easeInOutCubic(4)).toBe(1)
  })
})

describe('glideDuration', () => {
  it('takes no time at all when the pace is instant', () => {
    expect(glideDuration(1800, 'instant')).toBe(0)
  })

  it('holds a short hop open long enough to be seen', () => {
    // 40px at natural pace is ~15ms of travel; the floor is what makes it
    // visible rather than a flicker.
    expect(glideDuration(40, 'natural')).toBe(180)
  })

  it('caps a long haul so a 4K sweep stays brisk', () => {
    expect(glideDuration(4000, 'natural')).toBe(620)
    expect(glideDuration(4000, 'demo')).toBe(1400)
  })

  it('scales with distance between the clamps', () => {
    const short = glideDuration(800, 'natural')
    const long = glideDuration(1400, 'natural')
    expect(short).toBeGreaterThan(180)
    expect(long).toBeLessThan(620)
    expect(long).toBeGreaterThan(short)
  })

  it('is slower at demo pace than natural for the same distance', () => {
    expect(glideDuration(1200, 'demo')).toBeGreaterThan(glideDuration(1200, 'natural'))
  })
})

describe('pointAt', () => {
  const start = { x: 100, y: 200 }
  const target = { x: 900, y: 600 }

  it('begins on the start point and lands on the target', () => {
    expect(pointAt(start, target, 0)).toEqual(start)
    expect(pointAt(start, target, 1)).toEqual(target)
  })

  it('passes through the midpoint halfway along', () => {
    expect(pointAt(start, target, 0.5)).toEqual({ x: 500, y: 400 })
  })

  it('returns whole pixels, since that is all a pointer can occupy', () => {
    const { x, y } = pointAt(start, target, 0.37)
    expect(Number.isInteger(x)).toBe(true)
    expect(Number.isInteger(y)).toBe(true)
  })

  it('stays on the straight line between the two points', () => {
    // Both axes share one eased fraction, so the path cannot bow away.
    for (const t of [0.15, 0.4, 0.62, 0.88]) {
      const { x, y } = pointAt(start, target, t)
      const alongX = (x - start.x) / (target.x - start.x)
      const alongY = (y - start.y) / (target.y - start.y)
      expect(alongX).toBeCloseTo(alongY, 2)
    }
  })

  it('never leaves the segment, even at a clamped fraction', () => {
    expect(pointAt(start, target, -2)).toEqual(start)
    expect(pointAt(start, target, 9)).toEqual(target)
  })
})
