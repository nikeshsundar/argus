import { desktopCapturer, screen } from 'electron'
import type { CaptureInfo } from '../shared/types'

/**
 * Longest edge, in pixels, of the image actually sent to a model. Anything
 * larger costs tokens and latency without improving what the model can read.
 */
const MODEL_MAX_EDGE = 1568

/**
 * JPEG, not PNG, and this is measured rather than assumed.
 *
 * The same 1568px screen grab is 743 KB as a PNG and 140 KB as JPEG at 90, and
 * PNG costs 115ms to encode against 5ms. Agent Mode uploads one of these
 * before every single action, so the old path was spending roughly six hundred
 * extra kilobytes and a tenth of a second per step to encode losslessly
 * something no human will ever look at.
 *
 * 90 rather than 80: at 2x zoom, 90 shows no ringing around UI text, and the
 * agent is reading small labels to decide where to click. Saving another 37 KB
 * is not worth one misread button.
 */
const JPEG_QUALITY = 90

/** What the bytes in `Capture.model.image` actually are. */
export const MODEL_IMAGE_MIME = 'image/jpeg'

/**
 * A screen capture held entirely in memory.
 *
 * Privacy rule for this project: the PNG buffer is never written to disk, never
 * logged, and is dropped as soon as the request that used it completes. Only
 * `info` (dimensions/timestamps) is ever handed to the renderer.
 */
export interface Capture {
  /** Downscaled JPEG that gets sent to the model - see `MODEL_IMAGE_MIME`. */
  model: { png: Buffer; width: number; height: number }
  /**
   * Multiply a model-space coordinate by this to get a physical screen pixel.
   * Agent Mode and on-screen annotations both depend on this mapping.
   */
  scale: number
  /** Top-left of the captured display in desktop coordinates (multi-monitor). */
  origin: { x: number; y: number }
  info: CaptureInfo
}

/** Captures the display the mouse cursor is currently on. */
export async function captureActiveDisplay(): Promise<Capture> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)

  const physical = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor)
  }

  // Asked for at model size rather than grabbed at full resolution and shrunk
  // after. The grab is the expensive part either way (~400ms), but the old
  // route also allocated a full-resolution bitmap and resized it on every
  // single agent step, for an image that gets downscaled regardless.
  const longest = Math.max(physical.width, physical.height)
  const ratio = longest > MODEL_MAX_EDGE ? MODEL_MAX_EDGE / longest : 1
  const thumbnailSize = {
    width: Math.round(physical.width * ratio),
    height: Math.round(physical.height * ratio)
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false
  })

  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source) throw new Error('No screen source available to capture')

  const image = source.thumbnail
  if (image.isEmpty()) throw new Error('Screen capture came back empty')

  const modelSize = image.getSize()

  return {
    model: {
      png: image.toJPEG(JPEG_QUALITY),
      width: modelSize.width,
      height: modelSize.height
    },
    // Against the real screen, not against whatever the grab happened to
    // return - the agent's coordinates have to land on physical pixels.
    scale: physical.width / modelSize.width,
    origin: { x: display.bounds.x, y: display.bounds.y },
    info: {
      width: physical.width,
      height: physical.height,
      displayId: display.id,
      capturedAt: Date.now()
    }
  }
}
