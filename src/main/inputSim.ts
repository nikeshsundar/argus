import { Key, keyboard } from '@nut-tree-fork/nut-js'
import { clipboard, shell } from 'electron'
import { isSpreadsheetTitle, toScreenPoint, type AgentAction, type ScreenSize } from '../shared/agent'
import { activeWindowTitle } from './activeWindow'
import { externalUrlBlockReason } from '../shared/urlSafety'
import { launchApp } from './appIndex'
import { PACES } from '../shared/cursorPath'
import { clickHere, glideTo, markTyping, scrollHere } from './cursor'
import { loadSettings } from './settingsStore'

// nut-js' own mouseSpeed is not used: `glideTo` tweens the pointer itself so
// the overlay can be told where it is on every frame.

/** Accelerator-style key names the model may use, mapped onto nut-js keys. */
const KEY_MAP: Record<string, Key> = {
  enter: Key.Enter,
  return: Key.Enter,
  tab: Key.Tab,
  escape: Key.Escape,
  esc: Key.Escape,
  space: Key.Space,
  backspace: Key.Backspace,
  delete: Key.Delete,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  home: Key.Home,
  end: Key.End,
  pageup: Key.PageUp,
  pagedown: Key.PageDown,
  control: Key.LeftControl,
  ctrl: Key.LeftControl,
  alt: Key.LeftAlt,
  shift: Key.LeftShift,
  super: Key.LeftSuper,
  win: Key.LeftSuper,
  meta: Key.LeftSuper
}

function resolveKey(name: string): Key | null {
  const lower = name.trim().toLowerCase()
  if (KEY_MAP[lower]) return KEY_MAP[lower]

  if (/^f([1-9]|1[0-2])$/.test(lower)) {
    return Key[lower.toUpperCase() as keyof typeof Key] as Key
  }
  if (lower.length === 1) {
    const single = /[0-9]/.test(lower) ? `Num${lower}` : lower.toUpperCase()
    const key = Key[single as keyof typeof Key]
    if (typeof key === 'number') return key as Key
  }
  return null
}

/**
 * Longer than this, or spread over lines, and text is pasted, not typed.
 *
 * Typing a blog post key by key took minutes and did not survive the trip:
 * Google Docs turned "1. " into list items, autocorrect rewrote words, and one
 * stray focus change sent the rest of it somewhere else. A paste lands the
 * exact text in one keystroke. Short text is still typed, because watching a
 * URL or a search appear is how the user follows along.
 */
const PASTE_THRESHOLD = 40

async function enterText(text: string, pace: keyof typeof PACES): Promise<string> {
  await markTyping()
  if (text.length <= PASTE_THRESHOLD && !text.includes('\n')) {
    keyboard.config.autoDelayMs = PACES[pace].typeDelayMs
    await keyboard.type(text)
    return 'ok'
  }

  // Borrow the clipboard and hand it back. Only text is restored - an image
  // on the clipboard cannot be read back as text, so it is left alone rather
  // than overwritten with nothing.
  const previous = await clipboard.readText()
  await clipboard.writeText(text)
  await keyboard.pressKey(Key.LeftControl, Key.V)
  await keyboard.releaseKey(Key.LeftControl, Key.V)
  // Apps read the clipboard asynchronously after Ctrl+V; restoring too soon
  // pastes the old contents instead.
  await new Promise((resolve) => setTimeout(resolve, 400))
  if (previous) await clipboard.writeText(previous)

  const lines = text.split('\n').length
  return `pasted ${text.length} characters${lines > 1 ? ` (${lines} lines)` : ''} - check the screenshot that all of it landed in the right place`
}

/**
 * Performs one action on the real desktop.
 * Throws when an action names a key we can't map, so the loop can report it
 * back to the model rather than silently doing nothing.
 */
export async function executeAction(
  action: AgentAction,
  screen: ScreenSize,
  signal?: AbortSignal
): Promise<string> {
  const pace = loadSettings().cursorPace

  switch (action.type) {
    case 'launch': {
      const launched = await launchApp(action.name)
      if (!launched) {
        throw new Error(
          `No installed app matches "${action.name}". Try the exact name from the Start menu.`
        )
      }
      // Programs take a moment to paint their first window. The screen grab
      // before the next decision adds ~400ms of its own, so this only has to
      // cover the rest.
      await new Promise((resolve) => setTimeout(resolve, 450))
      return `launched ${launched}`
    }

    case 'openUrl': {
      // The last line of defence before the OS shell. openExternal would also
      // launch programs and reach files; only web and mail links get through,
      // whatever the model was talked into asking for. Throwing here becomes
      // feedback the agent can read, and stops a blind replay in its tracks.
      const blocked = externalUrlBlockReason(action.url)
      if (blocked) throw new Error(blocked)
      await shell.openExternal(action.url)
      await new Promise((resolve) => setTimeout(resolve, 450))
      return `opened ${action.url}`
    }

    case 'move': {
      await glideTo(toScreenPoint(action.x, action.y, screen), pace, signal)
      return 'ok'
    }

    case 'click': {
      await glideTo(toScreenPoint(action.x, action.y, screen), pace, signal)
      // A stop mid-glide must not land a click somewhere the model never chose.
      if (signal?.aborted) return 'cancelled'

      await clickHere(action.button, action.double)
      return 'ok'
    }

    case 'type':
      return await enterText(action.text, pace)

    case 'typeInto': {
      await glideTo(toScreenPoint(action.x, action.y, screen), pace, signal)
      if (signal?.aborted) return 'cancelled'

      await clickHere('left')
      // Focus does not always land on the same tick as the click.
      await new Promise((resolve) => setTimeout(resolve, 120))

      // In a spreadsheet, Ctrl+A selects the whole sheet and the Delete below
      // would then clear it. Typing into a selected cell replaces it anyway.
      const spreadsheet = isSpreadsheetTitle(await activeWindowTitle())

      // Replace what is in the field rather than adding to it. A click puts a
      // caret somewhere in the existing value; typing from there produced
      // things like "chatgpt.comchatgpt.com". type_text is the action for
      // adding to what is already there.
      if (!spreadsheet) {
        await keyboard.pressKey(Key.LeftControl, Key.A)
        await keyboard.releaseKey(Key.LeftControl, Key.A)
      }

      const entered = await enterText(action.text, pace)

      if (action.submit) {
        // Kill the browser's inline autocompletion before committing.
        //
        // Typing "chatgpt" leaves the address bar holding "chatgpt" plus a
        // selected completion from history - which can be any stale deep link
        // you once visited. Enter accepts the completion, not what was typed,
        // and the agent lands somewhere it never asked for and cannot explain.
        // Delete removes the selected part and leaves exactly the typed text.
        if (!spreadsheet) {
          await keyboard.pressKey(Key.Delete)
          await keyboard.releaseKey(Key.Delete)
          await new Promise((resolve) => setTimeout(resolve, 80))
        }

        await keyboard.pressKey(Key.Enter)
        await keyboard.releaseKey(Key.Enter)

        // Submitting usually navigates. Without this the next screenshot
        // catches a blank page mid-load, and the model plans against nothing.
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
      return entered
    }

    case 'keys': {
      const keys = action.keys.map((name) => {
        const key = resolveKey(name)
        if (key === null) throw new Error(`Unknown key "${name}"`)
        return key
      })
      await keyboard.pressKey(...keys)
      await keyboard.releaseKey(...keys)
      return 'ok'
    }

    case 'scroll': {
      const clicks = Math.max(1, Math.min(20, action.clicks))
      await scrollHere(action.direction, clicks * 100)
      return 'ok'
    }

    case 'wait':
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10, Math.max(0, action.seconds)) * 1000)
      )
      return 'ok'

    case 'research':
      // Run by the agent loop, which has the model to hand the answer to. A
      // replay never records one, so this is only a guard.
      return 'skipped - web_search is not a desktop action'

    case 'done':
      return 'ok'
  }
}
