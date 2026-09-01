import { globalShortcut } from 'electron'

let current: string | null = null

/**
 * Registers the global hotkey, replacing any previously registered one.
 * Returns false when the accelerator is invalid or already taken by another app.
 */
export function registerHotkey(accelerator: string, handler: () => void): boolean {
  unregisterHotkey()
  let ok = false
  try {
    ok = globalShortcut.register(accelerator, handler)
  } catch {
    ok = false
  }
  if (ok) current = accelerator
  return ok
}

export function unregisterHotkey(): void {
  if (!current) return
  globalShortcut.unregister(current)
  current = null
}

export function currentHotkey(): string | null {
  return current
}
