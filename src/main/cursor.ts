import { mouse, Point } from '@nut-tree-fork/nut-js'
import { glideDuration, pointAt, type CursorPace } from '../shared/cursorPath'
import { reportCursor } from './overlayWindow'

export { PACES, type CursorPace } from '../shared/cursorPath'

/**
 * ~83fps. Fast enough to look continuous, slow enough that the position
 * updates going to the overlay stay cheap.
 */
const FRAME_MS = 12

/** Below this, a glide is indistinguishable from a jump - so just jump. */
const MIN_GLIDE_PX = 2

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Walks the real pointer to a target instead of teleporting it.
 *
 * Driven by elapsed time rather than a step count, so a slow frame shortens the
 * next hop instead of stretching the whole glide. Aborting leaves the pointer
 * wherever it got to, which is what the Escape panic button wants.
 */
export async function glideTo(
  target: { x: number; y: number },
  pace: CursorPace,
  signal?: AbortSignal
): Promise<void> {
  const start = await mouse.getPosition()
  const distance = Math.hypot(target.x - start.x, target.y - start.y)
  const duration = glideDuration(distance, pace)

  if (duration === 0 || distance < MIN_GLIDE_PX) {
    await mouse.setPosition(new Point(target.x, target.y))
    reportCursor(target.x, target.y, 'move')
    return
  }

  const begin = Date.now()
  for (;;) {
    if (signal?.aborted) return

    const t = Math.min(1, (Date.now() - begin) / duration)
    const { x, y } = pointAt(start, target, t)

    await mouse.setPosition(new Point(x, y))
    reportCursor(x, y, 'move')

    if (t >= 1) return
    await sleep(FRAME_MS)
  }
}

/** Tells the overlay to ring the pointer, so a click is visible and not just heard. */
export async function markClick(): Promise<void> {
  const at = await mouse.getPosition()
  reportCursor(at.x, at.y, 'click')
}
