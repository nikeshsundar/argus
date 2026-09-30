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
