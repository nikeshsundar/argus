import { globalShortcut } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'

/**
 * Windows refuses to hand any `Win+<key>` combination to an ordinary app, so
 * Electron's globalShortcut can't register them. When that happens we fall back
 * to a low-level keyboard hook - the same approach PowerToys uses - which sees
 * the keystroke before the shell does.
 *
 * The hook can't *suppress* the key, but no default Windows action is bound to
 * the combinations we care about, so nothing else fires.
 */
type Strategy = 'shortcut' | 'hook' | null

interface Combo {
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  keycode: number
}

/** Modifier keycodes, tracked by hand because uiohook's modifier flags are unreliable for Win. */
const MODIFIER_KEYS = {
  meta: [UiohookKey.Meta, UiohookKey.MetaRight],
  ctrl: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  alt: [UiohookKey.Alt, UiohookKey.AltRight],
  shift: [UiohookKey.Shift, UiohookKey.ShiftRight]
} as const

/** Accelerator key names that don't map onto a UiohookKey entry directly. */
const KEY_ALIASES: Record<string, keyof typeof UiohookKey> = {
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  esc: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  space: 'Space'
}

let current: string | null = null
let strategy: Strategy = null
let hookHandler: (() => void) | null = null
let hookCombo: Combo | null = null
let hookStarted = false
let lastFired = 0

const held = { meta: false, ctrl: false, alt: false, shift: false }

/**
 * Turns an Electron accelerator ("Super+`", "Control+Shift+Space") into the
 * key/modifier combination the hook should watch for. Returns null when a key
 * isn't one we can map.
 */
export function parseAccelerator(accelerator: string): Combo | null {
  const combo: Combo = { meta: false, ctrl: false, alt: false, shift: false, keycode: -1 }

  for (const rawPart of accelerator.split('+')) {
    const part = rawPart.trim()
    const lower = part.toLowerCase()

    switch (lower) {
      case 'super':
      case 'meta':
      case 'cmd':
      case 'command':
        combo.meta = true
        continue
      case 'control':
      case 'ctrl':
      case 'commandorcontrol':
      case 'cmdorctrl':
        combo.ctrl = true
        continue
      case 'alt':
      case 'option':
        combo.alt = true
        continue
      case 'shift':
        combo.shift = true
        continue
    }

    const name =
      KEY_ALIASES[lower] ??
      KEY_ALIASES[part] ??
      (part.length === 1
        ? (part.toUpperCase() as keyof typeof UiohookKey)
        : ((part.charAt(0).toUpperCase() + part.slice(1)) as keyof typeof UiohookKey))

    const keycode = UiohookKey[name]
    if (typeof keycode !== 'number') return null
    combo.keycode = keycode
  }

  return combo.keycode === -1 ? null : combo
}

function onKeydown(event: { keycode: number }): void {
  for (const [name, codes] of Object.entries(MODIFIER_KEYS)) {
    if ((codes as readonly number[]).includes(event.keycode)) {
      held[name as keyof typeof held] = true
      return
    }
  }

  if (!hookCombo || !hookHandler || event.keycode !== hookCombo.keycode) return
  if (
    held.meta !== hookCombo.meta ||
    held.ctrl !== hookCombo.ctrl ||
    held.alt !== hookCombo.alt ||
    held.shift !== hookCombo.shift
  ) {
    return
  }

  // Key repeat fires continuously while held - only act on the first press.
  const now = Date.now()
  if (now - lastFired < 300) return
  lastFired = now
  hookHandler()
}

function onKeyup(event: { keycode: number }): void {
  for (const [name, codes] of Object.entries(MODIFIER_KEYS)) {
    if ((codes as readonly number[]).includes(event.keycode)) {
      held[name as keyof typeof held] = false
      return
    }
  }
}

function startHook(): void {
  if (hookStarted) return
  uIOhook.on('keydown', onKeydown)
  uIOhook.on('keyup', onKeyup)
  uIOhook.start()
  hookStarted = true
}

/**
 * Starts the shared low-level input hook, if it is not already running.
 *
 * Exported because Teach Mode watches the same hook for the learner's clicks -
 * uiohook allows only one hook per process, so it has to be this one.
 */
export function startInputHook(): void {
  startHook()
}

/**
 * Registers the global hotkey, replacing any previously registered one.
 * Returns false only when the accelerator can't be handled either way.
 */
export function registerHotkey(accelerator: string, handler: () => void): boolean {
  unregisterHotkey()

  try {
    if (globalShortcut.register(accelerator, handler)) {
      current = accelerator
      strategy = 'shortcut'
      return true
    }
  } catch {
    // Invalid accelerator for Electron - the hook may still manage it.
  }

  const combo = parseAccelerator(accelerator)
  if (!combo) return false

  hookCombo = combo
  hookHandler = handler
  startHook()
  current = accelerator
  strategy = 'hook'
  return true
}

export function unregisterHotkey(): void {
  if (strategy === 'shortcut' && current) globalShortcut.unregister(current)
  hookCombo = null
  hookHandler = null
  current = null
  strategy = null
}

/**
 * Calls `handler` whenever Escape is pressed anywhere, regardless of focus.
 * Agent Mode uses this as its panic button. Returns an unsubscribe function.
 */
export function watchEscape(handler: () => void): () => void {
  const listener = (event: { keycode: number }): void => {
    if (event.keycode === UiohookKey.Escape) handler()
  }
  startHook()
  uIOhook.on('keydown', listener)
  return () => uIOhook.off('keydown', listener)
}

/** Stops the keyboard hook. Call once on quit. */
export function disposeHotkeys(): void {
  unregisterHotkey()
  if (!hookStarted) return
  uIOhook.stop()
  hookStarted = false
}

export function currentHotkey(): string | null {
  return current
}

/** Which mechanism is servicing the hotkey - useful in diagnostics. */
export function hotkeyStrategy(): Strategy {
  return strategy
}
