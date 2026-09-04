/**
 * Where to put a floating panel relative to the pointer.
 *
 * Argus used to open its bar at a fixed spot a quarter of the way down the
 * screen. That is a reasonable place for a window and the wrong place for an
 * answer: you press the hotkey while looking at the thing you are asking
 * about, and the reply arrives somewhere else, so every question costs a
 * glance across the display and back.
 *
 * Putting it beside the pointer means it appears where you are already
 * looking. The whole difficulty is the edges - a naive offset puts the panel
 * half off screen the moment you ask about something near a corner, which is
 * exactly where toolbars and close buttons live.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface AnchorOptions {
  cursor: { x: number; y: number }
  panel: { width: number; height: number }
  /** The usable area of the display, in the same coordinate space as `cursor`. */
  bounds: Rect
  /** Gap between pointer and panel. */
  offset?: { x: number; y: number }
}

/**
 * Below-right of the pointer by default: that corner is empty most of the
 * time, because a pointer is usually resting on the thing it just clicked
 * rather than below it.
 */
export const DEFAULT_OFFSET = { x: 18, y: 22 }

/**
 * Places the panel near the pointer, flipping rather than sliding when it
 * would overflow.
 *
 * Flipping matters: a panel that slides back inside the screen ends up on top
 * of the pointer, covering the very control being asked about. Flipping to the
 * other side keeps the pointer clear. Only if flipping does not fit either is
 * it clamped, because being slightly wrong beats being off screen.
 */
export function anchorToCursor(options: AnchorOptions): { x: number; y: number } {
  const { cursor, panel, bounds } = options
  const offset = options.offset ?? DEFAULT_OFFSET

  let x = cursor.x + offset.x
  let y = cursor.y + offset.y

  // Off the right edge - put it to the left of the pointer instead.
  if (x + panel.width > bounds.x + bounds.width) {
    const flipped = cursor.x - offset.x - panel.width
    x = flipped >= bounds.x ? flipped : x
  }

  // Off the bottom - put it above the pointer instead.
  if (y + panel.height > bounds.y + bounds.height) {
    const flipped = cursor.y - offset.y - panel.height
    y = flipped >= bounds.y ? flipped : y
  }

  return {
    x: clamp(x, bounds.x, bounds.x + bounds.width - panel.width),
    y: clamp(y, bounds.y, bounds.y + bounds.height - panel.height)
  }
}

/**
 * Whether a remembered position still makes sense on this display.
 *
 * A panel dragged somewhere deliberately should stay there - that is the
 * user overriding the default, and overriding it back every time they open it
 * would be worse than never having anchored at all.
 */
export function fitsOnDisplay(position: { x: number; y: number }, panel: { width: number; height: number }, bounds: Rect): boolean {
  return (
    position.x >= bounds.x &&
    position.y >= bounds.y &&
    position.x + panel.width <= bounds.x + bounds.width &&
    position.y + panel.height <= bounds.y + bounds.height
  )
}

function clamp(value: number, low: number, high: number): number {
  // `high` can fall below `low` on a display smaller than the panel; the low
  // edge wins there, so the top-left stays visible rather than the panel
  // being pushed off the opposite side.
  return Math.max(low, Math.min(value, Math.max(low, high)))
}
