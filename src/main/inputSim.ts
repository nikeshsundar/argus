import { Button, Key, keyboard, mouse, Point } from '@nut-tree-fork/nut-js'
import { toScreenPoint, type AgentAction, type ScreenSize } from '../shared/agent'

// The defaults animate the cursor and add per-keystroke delays, which makes a
// multi-step task crawl. Keep a small delay so target apps register the input.
mouse.config.mouseSpeed = 3000
keyboard.config.autoDelayMs = 8

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
export async function executeAction(action: AgentAction, screen: ScreenSize): Promise<void> {
  switch (action.type) {
    case 'move': {
      const point = toScreenPoint(action.x, action.y, screen)
      await mouse.setPosition(new Point(point.x, point.y))
      return
    }

    case 'click': {
      const point = toScreenPoint(action.x, action.y, screen)
      await mouse.setPosition(new Point(point.x, point.y))
      const button = action.button === 'right' ? Button.RIGHT : Button.LEFT
      if (action.double) {
        await mouse.doubleClick(button)
      } else {
        await mouse.click(button)
      }
      return
    }

    case 'type':
      await keyboard.type(action.text)
      return

    case 'keys': {
      const keys = action.keys.map((name) => {
        const key = resolveKey(name)
        if (key === null) throw new Error(`Unknown key "${name}"`)
        return key
      })
      await keyboard.pressKey(...keys)
      await keyboard.releaseKey(...keys)
      return
    }

    case 'scroll': {
      const clicks = Math.max(1, Math.min(20, action.clicks))
      if (action.direction === 'down') {
        await mouse.scrollDown(clicks * 100)
      } else {
        await mouse.scrollUp(clicks * 100)
      }
      return
    }

    case 'wait':
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10, Math.max(0, action.seconds)) * 1000)
      )
      return

    case 'done':
      return
  }
}
