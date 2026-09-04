import { Button, Key, keyboard, mouse } from '@nut-tree-fork/nut-js'
import { shell } from 'electron'
import { toScreenPoint, type AgentAction, type ScreenSize } from '../shared/agent'
import { launchApp } from './appIndex'
import { PACES } from '../shared/cursorPath'
import { glideTo, markClick } from './cursor'
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
      await new Promise((resolve) => setTimeout(resolve, 900))
      return `launched ${launched}`
    }

    case 'openUrl': {
      await shell.openExternal(action.url)
      await new Promise((resolve) => setTimeout(resolve, 900))
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

      await markClick()
      const button = action.button === 'right' ? Button.RIGHT : Button.LEFT
      if (action.double) {
        await mouse.doubleClick(button)
      } else {
        await mouse.click(button)
      }
      return 'ok'
    }

    case 'type':
      // Typing is worth watching, so it runs at the same pace as the pointer.
      keyboard.config.autoDelayMs = PACES[pace].typeDelayMs
      await keyboard.type(action.text)
      return 'ok'

    case 'typeInto': {
      await glideTo(toScreenPoint(action.x, action.y, screen), pace, signal)
      if (signal?.aborted) return 'cancelled'

      await markClick()
      await mouse.click(Button.LEFT)
      // Focus does not always land on the same tick as the click.
      await new Promise((resolve) => setTimeout(resolve, 120))

      // Replace what is in the field rather than adding to it. A click puts a
      // caret somewhere in the existing value; typing from there produced
      // things like "chatgpt.comchatgpt.com". type_text is the action for
      // adding to what is already there.
      await keyboard.pressKey(Key.LeftControl, Key.A)
      await keyboard.releaseKey(Key.LeftControl, Key.A)

      keyboard.config.autoDelayMs = PACES[pace].typeDelayMs
      await keyboard.type(action.text)

      if (action.submit) {
        // Kill the browser's inline autocompletion before committing.
        //
        // Typing "chatgpt" leaves the address bar holding "chatgpt" plus a
        // selected completion from history - which can be any stale deep link
        // you once visited. Enter accepts the completion, not what was typed,
        // and the agent lands somewhere it never asked for and cannot explain.
        // Delete removes the selected part and leaves exactly the typed text.
        await keyboard.pressKey(Key.Delete)
        await keyboard.releaseKey(Key.Delete)
        await new Promise((resolve) => setTimeout(resolve, 80))

        await keyboard.pressKey(Key.Enter)
        await keyboard.releaseKey(Key.Enter)

        // Submitting usually navigates. Without this the next screenshot
        // catches a blank page mid-load, and the model plans against nothing.
        await new Promise((resolve) => setTimeout(resolve, 700))
      }
      return 'ok'
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
      if (action.direction === 'down') {
        await mouse.scrollDown(clicks * 100)
      } else {
        await mouse.scrollUp(clicks * 100)
      }
      return 'ok'
    }

    case 'wait':
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10, Math.max(0, action.seconds)) * 1000)
      )
      return 'ok'

    case 'done':
      return 'ok'
  }
}
