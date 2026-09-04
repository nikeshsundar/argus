import { describe, expect, it } from 'vitest'
import { easeInOutCubic, glideDuration, PACES, pointAt, springAt } from '../src/shared/cursorPath'

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
    // A few dozen pixels is a handful of milliseconds of travel; the floor is
    // what makes it visible rather than a flicker. Asserted against the pace
    // itself, so retuning for speed does not have to come here and edit a
    // magic number - which is how a test stops checking anything.
    expect(glideDuration(40, 'natural')).toBe(PACES.natural.minMs)
  })

  it('caps a long haul so a 4K sweep stays brisk', () => {
    expect(glideDuration(4000, 'natural')).toBe(PACES.natural.maxMs)
    expect(glideDuration(4000, 'demo')).toBe(PACES.demo.maxMs)
  })

  it('keeps the pointer watchable without making it a journey', () => {
    // The two ends of the range Agent Mode actually runs at. Nobody should
    // wait a second for a pointer, and nobody can follow a 20ms jump.
    expect(PACES.natural.minMs).toBeGreaterThanOrEqual(60)
    expect(PACES.natural.maxMs).toBeLessThanOrEqual(350)
  })

  it('scales with distance between the clamps', () => {
    // The distances have to come from the pace too. Hardcoding them meant that
    // making the pointer faster moved the ceiling below the test's "long" hop,
    // and the test failed for a reason that had nothing to do with scaling.
    const { pxPerSecond, minMs, maxMs } = PACES.natural
    const floorPx = (minMs / 1000) * pxPerSecond
    const ceilPx = (maxMs / 1000) * pxPerSecond

    const short = glideDuration(floorPx * 1.2, 'natural')
    const long = glideDuration(ceilPx * 0.9, 'natural')

    expect(short).toBeGreaterThan(minMs)
    expect(long).toBeLessThan(maxMs)
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

  it('passes through the midpoint halfway along at demo pace', () => {
    // demo keeps the symmetric ease, so half the time really is half the way.
    expect(pointAt(start, target, 0.5, 'demo')).toEqual({ x: 500, y: 400 })
  })

  it('is well past halfway at half the time on a spring', () => {
    // A spring front-loads its travel and then settles, so the old assertion
    // that t=0.5 lands on the midpoint was measuring the easing curve rather
    // than anything about pointAt.
    const { x } = pointAt(start, target, 0.5, 'natural')
    expect(x).toBeGreaterThan(500)
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

describe('springAt', () => {
  it('starts where it started and ends exactly on target', () => {
    // The click happens at the end, so the last value has to be exact.
    expect(springAt(0)).toBe(0)
    expect(springAt(1)).toBe(1)
  })

  it('overshoots, which is the whole point of a spring', () => {
    const samples = Array.from({ length: 100 }, (_, i) => springAt(i / 100))
    expect(Math.max(...samples)).toBeGreaterThan(1)
  })

  it('overshoots by a little, not a lot', () => {
    // Enough to read as momentum, not so much that it looks like a wobble.
    const samples = Array.from({ length: 200 }, (_, i) => springAt(i / 200))
    expect(Math.max(...samples)).toBeLessThan(1.2)
  })

  it('settles rather than oscillating forever', () => {
    // The last stretch should be sitting on the target, not still ringing.
    for (const t of [0.85, 0.9, 0.95]) {
      expect(Math.abs(springAt(t) - 1), `t=${t}`).toBeLessThan(0.05)
    }
  })

  it('clamps outside its range instead of running away', () => {
    expect(springAt(-1)).toBe(0)
    expect(springAt(4)).toBe(1)
  })
})
