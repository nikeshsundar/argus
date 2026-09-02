import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { AgentCursorEvent, AgentStepEvent } from '../shared/types'

let win: BrowserWindow | null = null

/**
 * Where the overlay currently sits, and at what DPI. Pointer coordinates arrive
 * from nut-js in physical pixels spanning the whole desktop; the overlay's own
 * CSS pixels are display-relative, so both offset and scale have to come off.
 */
let origin = { x: 0, y: 0 }
let scaleFactor = 1

/**
 * A transparent, click-through frame drawn over the active display while the
 * agent has control. It exists so the machine never operates itself silently.
 */
function ensureOverlay(): BrowserWindow {
  if (win && !win.isDestroyed()) return win

  win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  // Never intercept the user's clicks - they must stay in control of the machine.
  win.setIgnoreMouseEvents(true)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  return win
}

export function showOverlay(): void {
  const overlay = ensureOverlay()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  origin = { x: display.bounds.x, y: display.bounds.y }
  scaleFactor = display.scaleFactor
  overlay.setBounds(display.bounds)
  overlay.showInactive()
}

export function updateOverlay(event: AgentStepEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('argus:agent-step', event)
}

/**
 * Streams the pointer to the overlay so it can draw a halo around it.
 *
 * Skipped while the overlay is hidden - which is exactly when a screenshot is
 * being taken, keeping our own decoration out of what the model reads.
 */
export function reportCursor(x: number, y: number, phase: AgentCursorEvent['phase']): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  win.webContents.send('argus:agent-cursor', {
    x: x / scaleFactor - origin.x,
    y: y / scaleFactor - origin.y,
    phase
  } satisfies AgentCursorEvent)
}

export function hideOverlay(): void {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide()
}

/** True while the frame is on screen - used to keep it out of screenshots. */
export function isOverlayVisible(): boolean {
  return Boolean(win && !win.isDestroyed() && win.isVisible())
}
