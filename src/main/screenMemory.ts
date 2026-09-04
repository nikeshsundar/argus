import { desktopCapturer, screen } from 'electron'
import {
  CAPTURE_INTERVAL_MS,
  DEFAULT_MINUTES,
  frameDelta,
  MAX_BYTES,
  MAX_STORED_FRAMES,
  minutesToMs,
  SAME_FRAME_DELTA,
  trimFrames,
  type MemoryFrame,
  type MemoryStatus
} from '../shared/recall'

/**
 * The rolling record of what has been on screen.
 *
 * Two rules govern this file, and both are promises made in the README:
 *
 *  1. Nothing here ever touches the disk. Frames are JPEG buffers in this
 *     process and nowhere else. Turning memory off, purging, or quitting drops
 *     them; there is no path that writes one out.
 *  2. It only runs when it has been switched on, and it is off by default.
 *
 * The recorder is also deliberately blind to its own app: while the bar is
 * open, or the agent overlay is up, the tick is skipped. A buffer full of
 * Argus's own UI is both useless and a way to record the user's typing.
 */

/** Longest edge kept. Small enough to hold hundreds, large enough to read an error code. */
const STORE_MAX_EDGE = 1280

/** Size the change detector compares at. 576 pixels is plenty to tell "different screen". */
const THUMB = { width: 32, height: 18 }

/** JPEG, not PNG: a tenth of the size, and nobody is pixel-peeping a timeline. */
const JPEG_QUALITY = 70

let frames: MemoryFrame[] = []
let timer: ReturnType<typeof setInterval> | null = null
let retentionMs = minutesToMs(DEFAULT_MINUTES)
let lastThumb: Uint8Array | null = null
/** A slow grab must not overlap the next tick. */
let capturing = false
let shouldSkip: () => boolean = () => false

/**
 * Tells the recorder when to keep its eyes shut - while our own windows are up.
 * Passed in rather than imported so this file stays testable and has no opinion
 * about the rest of the app.
 */
export function configureMemory(options: { shouldSkip: () => boolean }): void {
  shouldSkip = options.shouldSkip
}

export function isRecording(): boolean {
  return timer !== null
}

export function retentionMinutes(): number {
  return Math.round(retentionMs / 60_000)
}

export function startMemory(minutes: number = retentionMinutes()): void {
  retentionMs = minutesToMs(minutes)
  if (timer) return

  timer = setInterval(() => void tick(), CAPTURE_INTERVAL_MS)
  // Node keeps the process alive for a pending timer; this one should never be
  // the reason a quit hangs.
  timer.unref?.()
  void tick()
}

/**
 * Stops recording and forgets everything.
 *
 * "Off" has to mean gone. A recorder that stops but keeps ten minutes of your
 * screen in RAM is the behaviour people are afraid of.
 */
export function stopMemory(): number {
  if (timer) clearInterval(timer)
  timer = null
  return purgeMemory()
}

export function setRetention(minutes: number): void {
  retentionMs = minutesToMs(minutes)
  frames = trimFrames(frames, limits(), Date.now())
}

/** Drops every frame. Returns how many were forgotten. */
export function purgeMemory(): number {
  const count = frames.length
  frames = []
  lastThumb = null
  return count
}

export function memoryStatus(): MemoryStatus {
  return {
    recording: isRecording(),
    frames: frames.length,
    bytes: frames.reduce((sum, frame) => sum + frame.jpeg.byteLength, 0),
    oldestAt: frames[0]?.at ?? null,
    windowMs: retentionMs
  }
}

/** Everything currently held, oldest first. The caller decides what to send. */
export function heldFrames(): MemoryFrame[] {
  return frames
}

function limits(): { windowMs: number; maxBytes: number; maxFrames: number } {
  return { windowMs: retentionMs, maxBytes: MAX_BYTES, maxFrames: MAX_STORED_FRAMES }
}

async function tick(): Promise<void> {
  if (capturing || shouldSkip()) return
  capturing = true

  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const full = {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }

    // Asked for at storage size rather than full resolution and shrunk after:
    // this runs every five seconds forever, and the difference is most of the
    // cost of the grab.
    const longest = Math.max(full.width, full.height)
    const ratio = longest > STORE_MAX_EDGE ? STORE_MAX_EDGE / longest : 1
    const thumbnailSize = {
      width: Math.round(full.width * ratio),
      height: Math.round(full.height * ratio)
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize,
      fetchWindowIcons: false
    })

    const source = sources.find((one) => one.display_id === String(display.id)) ?? sources[0]
    const image = source?.thumbnail
    if (!image || image.isEmpty()) return

    const now = Date.now()
    const thumb = new Uint8Array(image.resize(THUMB).toBitmap())

    // An unchanged screen extends the moment it already belongs to instead of
    // adding a near-identical copy. Ten idle minutes cost one frame.
    const previous = frames[frames.length - 1]
    if (previous && lastThumb && frameDelta(thumb, lastThumb) < SAME_FRAME_DELTA) {
      previous.until = now
      frames = trimFrames(frames, limits(), now)
      return
    }

    const size = image.getSize()
    frames.push({
      jpeg: new Uint8Array(image.toJPEG(JPEG_QUALITY)),
      width: size.width,
      height: size.height,
      at: now,
      until: now
    })
    lastThumb = thumb
    frames = trimFrames(frames, limits(), now)
  } catch {
    // A failed grab is not worth reporting: the screen is locked, a display was
    // unplugged, or a fullscreen app refused capture. The next tick tries again.
  } finally {
    capturing = false
  }
}
