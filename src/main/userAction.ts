import { uIOhook, UiohookKey } from 'uiohook-napi'
import { startInputHook } from './hotkey'

/** How the learner ended a step. */
export type UserAction =
  | { kind: 'clicked'; x: number; y: number }
  | { kind: 'advanced' }
  | { kind: 'stopped' }

/** Keys that mean "I've done it, move on". */
const ADVANCE_KEYS: number[] = [UiohookKey.Space, UiohookKey.Enter]

/**
 * Blocks until the learner does something, then reports what.
 *
 * This is what separates a lesson from a slideshow: the step stays on screen
 * for as long as the person needs, and nothing advances on a timer. The overlay
 * is click-through, so their click reaches the real UI underneath and we only
 * observe it.
 *
 * Resolves on a click anywhere, on Space or Enter, or on Escape to abandon the
 * lesson. Every listener is removed before resolving, including on abort, so a
 * stopped lesson leaves nothing attached to the global hook.
 */
export function waitForUserAction(signal: AbortSignal): Promise<UserAction> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ kind: 'stopped' })
      return
    }

    const finish = (action: UserAction): void => {
      uIOhook.off('click', onClick)
      uIOhook.off('keydown', onKeydown)
      signal.removeEventListener('abort', onAbort)
      resolve(action)
    }

    const onClick = (event: { x: number; y: number }): void => {
      finish({ kind: 'clicked', x: event.x, y: event.y })
    }

    const onKeydown = (event: { keycode: number }): void => {
      if (event.keycode === UiohookKey.Escape) return finish({ kind: 'stopped' })
      if (ADVANCE_KEYS.includes(event.keycode)) return finish({ kind: 'advanced' })
    }

    const onAbort = (): void => finish({ kind: 'stopped' })

    startInputHook()
    uIOhook.on('click', onClick)
    uIOhook.on('keydown', onKeydown)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
