import { Button, mouse, Point } from '@nut-tree-fork/nut-js'
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

/**
 * Where the agent's own cursor is, in physical pixels.
 *
 * The agent no longer drives the user's pointer around the screen. It has a
 * cursor of its own, drawn on the overlay, and that is what glides. The real
 * pointer stays wherever the user left it - it only visits the target for the
 * instant a click needs it (see `flick`). Null until the first move, when it
 * starts from the real pointer so it appears where the eye already is.
 */
let ghost: { x: number; y: number } | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ghostStart(): Promise<{ x: number; y: number }> {
  if (ghost) return ghost
  const real = await mouse.getPosition()
  ghost = { x: real.x, y: real.y }
  return ghost
}

/** Forgets the agent cursor's position, so the next run starts at the pointer. */
export function resetGhost(): void {
  ghost = null
}

/**
 * Glides the agent's cursor to a target.
 *
 * Driven by elapsed time rather than a step count, so a slow frame shortens the
 * next hop instead of stretching the whole glide. Aborting leaves the cursor
 * wherever it got to, which is what the Escape panic button wants.
 */
export async function glideTo(
  target: { x: number; y: number },
  pace: CursorPace,
  signal?: AbortSignal
): Promise<void> {
  const start = await ghostStart()
  const distance = Math.hypot(target.x - start.x, target.y - start.y)
  const duration = glideDuration(distance, pace)

  if (duration === 0 || distance < MIN_GLIDE_PX) {
    ghost = { x: target.x, y: target.y }
    reportCursor(target.x, target.y, 'move')
    return
  }

  const begin = Date.now()
  for (;;) {
    if (signal?.aborted) return

    const t = Math.min(1, (Date.now() - begin) / duration)
    const { x, y } = pointAt(start, target, t, pace)
    ghost = { x, y }
    reportCursor(x, y, 'move')

    if (t >= 1) {
      ghost = { x: target.x, y: target.y }
      return
    }
    await sleep(FRAME_MS)
  }
}

/**
 * Borrows the real pointer for one instant.
 *
 * Windows delivers a click wherever the real pointer is, so it has to be there
 * for the click itself - but only for that. It goes, does the one thing, and
 * is put back where the user left it, in a few milliseconds. The user's hand
 * never has to fight the agent for the mouse.
 */
async function flick<T>(at: { x: number; y: number }, act: () => Promise<T>): Promise<T> {
  const home = await mouse.getPosition()
  await mouse.setPosition(new Point(at.x, at.y))
  try {
    return await act()
  } finally {
    await mouse.setPosition(home)
  }
}

/** Clicks where the agent's cursor is. */
export async function clickHere(button: 'left' | 'right' = 'left', double = false): Promise<void> {
  const at = await ghostStart()
  reportCursor(at.x, at.y, 'click')
  const which = button === 'right' ? Button.RIGHT : Button.LEFT
  await flick(at, async () => {
    // A beat for the app to register the pointer has arrived before it is
    // pressed. Without it some apps treat the click as landing where the
    // pointer came from.
    await sleep(12)
    if (double) await mouse.doubleClick(which)
    else await mouse.click(which)
  })
}

/** Scrolls the window under the agent's cursor. */
export async function scrollHere(direction: 'up' | 'down', amount: number): Promise<void> {
  const at = await ghostStart()
  reportCursor(at.x, at.y, 'scroll')
  await flick(at, async () => {
    await sleep(12)
    if (direction === 'down') await mouse.scrollDown(amount)
    else await mouse.scrollUp(amount)
  })
}

/** Tells the overlay the agent is typing, so its cursor can show it. */
export async function markTyping(): Promise<void> {
  const at = await ghostStart()
  reportCursor(at.x, at.y, 'type')
}

/**
 * Puts the agent's cursor on screen at the start of a run, on top of the
 * user's pointer, so they see where it starts rather than it appearing
 * mid-glide from nowhere.
 */
export async function presentGhost(): Promise<void> {
  resetGhost()
  const at = await ghostStart()
  reportCursor(at.x, at.y, 'move')
}
