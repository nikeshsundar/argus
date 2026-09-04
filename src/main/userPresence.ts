import { uIOhook, UiohookKey } from 'uiohook-napi'
import { startInputHook } from './hotkey'

/**
 * Notices when the person is using their own machine.
 *
 * The whole difficulty is that the agent's input looks exactly like the user's.
 * nut.js drives the real mouse through SendInput, the OS hook sees those events
 * the same as any other, and an agent that watched them naively would pause
 * itself on its very first click.
 *
 * So the agent declares its own actions: everything inside `asAgent` is ours,
 * everything outside it is theirs. Simple, and it fails in the harmless
 * direction - a click landing in the same instant as one of the agent's is
 * missed, and the next one is caught.
 */

/**
 * Synthetic events do not always arrive before the call that sent them returns.
 * Without a short tail, the last click of an action is read as the user's and
 * the agent pauses for something it did itself.
 */
const SETTLE_MS = 150

let lastInput = 0
/** Nested actions are possible, so this is a depth rather than a flag. */
let suppressing = 0
let releaseTimer: ReturnType<typeof setTimeout> | null = null
let watchers = 0
let attached = false

function note(): void {
  if (suppressing > 0 || releaseTimer !== null) return
  lastInput = Date.now()
}

const onMouseDown = (): void => note()
const onWheel = (): void => note()
const onKeydown = (event: { keycode: number }): void => {
  // Escape means stop, not pause, and it is handled by watchEscape. Counting
  // it here would make the agent stand politely aside from a request to quit.
  if (event.keycode === UiohookKey.Escape) return
  note()
}

/**
 * Starts noticing. Reference-counted, because a replay can begin while an
 * agent run is still tearing down.
 */
export function watchUser(): () => void {
  watchers++
  if (!attached) {
    startInputHook()
    uIOhook.on('mousedown', onMouseDown)
    uIOhook.on('wheel', onWheel)
    uIOhook.on('keydown', onKeydown)
    attached = true
  }

  // Anything from before this run is not a reason to start off paused.
  lastInput = 0

  let released = false
  return () => {
    if (released) return
    released = true
    watchers = Math.max(0, watchers - 1)
    if (watchers === 0 && attached) {
      uIOhook.off('mousedown', onMouseDown)
      uIOhook.off('wheel', onWheel)
      uIOhook.off('keydown', onKeydown)
      attached = false
    }
  }
}

/** When the user last clicked, typed or scrolled. 0 if they have not. */
export function lastUserInputAt(): number {
  return lastInput
}

/**
 * Marks everything `fn` does as the agent's own input, not the user's.
 *
 * The suppression outlives the call by `SETTLE_MS` so the tail of a synthetic
 * click cannot be mistaken for a person reaching for the mouse.
 */
export async function asAgent<T>(fn: () => Promise<T>): Promise<T> {
  suppressing++
  if (releaseTimer) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }

  try {
    return await fn()
  } finally {
    suppressing--
    if (suppressing === 0) {
      releaseTimer = setTimeout(() => {
        releaseTimer = null
      }, SETTLE_MS)
    }
  }
}
