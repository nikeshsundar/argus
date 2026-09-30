import { getActiveWindow } from '@nut-tree-fork/nut-js'

/**
 * The title of the window that has focus, as Windows reports it.
 *
 * This is what makes app limits real: the model can say it is working in
 * Gmail, but the OS says which window the next keystroke will land in. Null
 * when it cannot be read, so the caller skips that rule instead of guessing.
 */
export async function activeWindowTitle(): Promise<string | null> {
  try {
    const window = await getActiveWindow()
    return await window.title
  } catch {
    return null
  }
}

/** Where the focused window is, in physical pixels. Null when unreadable. */
export async function activeWindowRegion(): Promise<{
  left: number
  top: number
  width: number
  height: number
} | null> {
  try {
    const window = await getActiveWindow()
    const region = await window.region
    if (region.width < 50 || region.height < 50) return null
    return { left: region.left, top: region.top, width: region.width, height: region.height }
  } catch {
    return null
  }
}
