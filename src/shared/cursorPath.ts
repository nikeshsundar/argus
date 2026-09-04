/**
 * The geometry behind the agent's pointer movement.
 *
 * Kept free of nut-js and Electron so the timing can be tested directly - the
 * part worth checking is the maths, not the syscall that moves the pointer.
 */

/**
 * How visibly the agent moves the pointer.
 *
 * The pointer is the only part of Agent Mode a user can follow in real time, so
 * it is deliberately slower than the machine is capable of. `instant` exists for
 * anyone who would rather have speed than a show.
 */
export type CursorPace = 'instant' | 'natural' | 'demo'

export interface PaceProfile {
  /** Travel speed. Distance is covered at this rate before the clamps apply. */
  pxPerSecond: number
  /** Floor, so a short hop is still long enough for the eye to catch. */
  minMs: number
  /** Ceiling, so crossing a 4K screen does not become a journey. */
  maxMs: number
  /** Per-keystroke delay, so typing reads as typing rather than a paste. */
  typeDelayMs: number
}

export const PACES: Record<CursorPace, PaceProfile> = {
  instant: { pxPerSecond: Infinity, minMs: 0, maxMs: 0, typeDelayMs: 4 },
  // Retuned for speed. The old numbers spent up to 620ms crossing the screen
  // and did it a dozen times a task, which is most of a slow-feeling run for a
  // flourish nobody asked to watch twice. 300ms still reads unmistakably as a
  // glide rather than a jump, and you can still follow it.
  natural: { pxPerSecond: 4200, minMs: 90, maxMs: 300, typeDelayMs: 7 },
  // Untouched. This one exists to be watched - for recording, and for anyone
  // who wants to see exactly what is happening.
  demo: { pxPerSecond: 1100, minMs: 420, maxMs: 1400, typeDelayMs: 45 }
}

/**
 * A damped spring, settling at 1 after a small overshoot.
 *
 * The pointer used to travel on a pure ease: correct, and slightly dead. A
 * spring arrives with a little momentum and settles, which is what makes a
 * moving thing read as alive rather than animated. `damping` below 1 is
 * underdamped, so it passes the target and comes back.
 *
 * Overshooting is safe here. The glide only decides where the pointer is drawn
 * on the way; the click happens after it lands, at the exact coordinate.
 */
export function springAt(t: number, damping = 0.62): number {
  const clamped = Math.min(1, Math.max(0, t))
  if (clamped >= 1) return 1

  // Chosen so the overshoot is visible but small - about 8% at the default
  // damping, which reads as life rather than as a wobble.
  const frequency = 9
  const decay = Math.exp(-damping * frequency * clamped)
  return 1 - decay * Math.cos(frequency * Math.sqrt(1 - damping * damping) * clamped)
}

/** Slow at both ends, quick through the middle - how a hand actually moves. */
export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2
}

/** How long a glide across `distance` pixels should take at this pace. */
export function glideDuration(distance: number, pace: CursorPace): number {
  if (pace === 'instant') return 0
  const { pxPerSecond, minMs, maxMs } = PACES[pace]
  return Math.min(maxMs, Math.max(minMs, (distance / pxPerSecond) * 1000))
}

/** The pointer's whole-pixel position a fraction `t` of the way along a glide. */
export function pointAt(
  start: { x: number; y: number },
  target: { x: number; y: number },
  t: number,
  pace: CursorPace = 'natural'
): { x: number; y: number } {
  // A spring rather than a plain ease: it arrives with a little momentum and
  // settles, which is the difference between a pointer that looks animated and
  // one that looks alive. `demo` keeps the ease, because a deliberate
  // demonstration should not bounce.
  const eased = pace === 'demo' ? easeInOutCubic(t) : springAt(t)
  return {
    x: Math.round(start.x + (target.x - start.x) * eased),
    y: Math.round(start.y + (target.y - start.y) * eased)
  }
}
