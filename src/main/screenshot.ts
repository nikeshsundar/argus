import { desktopCapturer, screen } from 'electron'
import type { CaptureInfo } from '../shared/types'

/**
 * Longest edge, in pixels, of the image actually sent to a model. Anything
 * larger costs tokens and latency without improving what the model can read.
 */
const MODEL_MAX_EDGE = 1568

/**
 * A screen capture held entirely in memory.
 *
 * Privacy rule for this project: the PNG buffer is never written to disk, never
 * logged, and is dropped as soon as the request that used it completes. Only
 * `info` (dimensions/timestamps) is ever handed to the renderer.
 */
export interface Capture {
  /** Downscaled PNG that gets sent to the model. */
  model: { png: Buffer; width: number; height: number }
  /**
   * Multiply a model-space coordinate by this to get a physical screen pixel.
   * Agent Mode and on-screen annotations both depend on this mapping.
   */
  scale: number
  info: CaptureInfo
}

/** Captures the display the mouse cursor is currently on. */
export async function captureActiveDisplay(): Promise<Capture> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)

  // Ask for the capture at true pixel resolution first, so downscaling starts
  // from the sharpest source available.
  const thumbnailSize = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor)
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false
  })

  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source) throw new Error('No screen source available to capture')

  const full = source.thumbnail
  if (full.isEmpty()) throw new Error('Screen capture came back empty')

  const fullSize = full.getSize()
  const longestEdge = Math.max(fullSize.width, fullSize.height)
  const ratio = longestEdge > MODEL_MAX_EDGE ? MODEL_MAX_EDGE / longestEdge : 1

  const modelImage =
    ratio < 1
      ? full.resize({
          width: Math.round(fullSize.width * ratio),
          height: Math.round(fullSize.height * ratio),
          quality: 'better'
        })
      : full

  const modelSize = modelImage.getSize()

  return {
    model: { png: modelImage.toPNG(), width: modelSize.width, height: modelSize.height },
    scale: fullSize.width / modelSize.width,
    info: {
      width: fullSize.width,
      height: fullSize.height,
      displayId: display.id,
      capturedAt: Date.now()
    }
  }
}
