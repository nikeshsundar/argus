import { describe, expect, it, vi } from 'vitest'

// hotkey.ts pulls in Electron and a native hook; neither is available under
// vitest, and parseAccelerator touches neither at import time.
vi.mock('electron', () => ({ globalShortcut: { register: vi.fn(), unregister: vi.fn() } }))

const { parseAccelerator } = await import('../src/main/hotkey')

describe('parseAccelerator', () => {
  it('maps Win+backtick to the backquote key with the meta modifier', () => {
    expect(parseAccelerator('Super+`')).toEqual({
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
      keycode: 41 // UiohookKey.Backquote
    })
  })

  it('handles multiple modifiers', () => {
    const combo = parseAccelerator('Control+Shift+Space')
    expect(combo).toMatchObject({ ctrl: true, shift: true, meta: false, alt: false })
  })

  it('accepts single letters', () => {
    expect(parseAccelerator('Control+A')?.ctrl).toBe(true)
  })

  it('accepts function keys', () => {
    expect(parseAccelerator('F9')).toMatchObject({ meta: false, ctrl: false })
  })

  it('returns null when no key is present', () => {
    expect(parseAccelerator('Control+Shift')).toBeNull()
  })

  it('returns null for an unknown key name', () => {
    expect(parseAccelerator('Control+Nonsense')).toBeNull()
  })
})
