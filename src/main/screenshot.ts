import { desktopCapturer, screen } from 'electron'
import type { CaptureInfo } from '../shared/types'

/**
 * A screen capture held entirely in memory.
 *
 * Privacy rule for this project: the PNG buffer is never written to disk, never
 * logged, and is dropped as soon as the request that used it completes. Only
 * `info` (dimensions/timestamps) is ever handed to the renderer.
 */
export interface Capture {
  png: Buffer
  info: CaptureInfo
}

/** Captures the display the mouse cursor is currently on. */
export async function captureActiveDisplay(): Promise<Capture> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)

  // Ask for the capture at true pixel resolution so coordinates the model
  // returns map cleanly back onto the real screen.
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

  const image = source.thumbnail
  if (image.isEmpty()) throw new Error('Screen capture came back empty')

  const size = image.getSize()
  return {
    png: image.toPNG(),
    info: {
      width: size.width,
      height: size.height,
      displayId: display.id,
      capturedAt: Date.now()
    }
  }
}
