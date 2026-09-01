import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { AgentStepEvent } from '../shared/types'

let win: BrowserWindow | null = null

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
  const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  overlay.setBounds(bounds)
  overlay.showInactive()
}

export function updateOverlay(event: AgentStepEvent): void {
  if (win && !win.isDestroyed()) win.webContents.send('argus:agent-step', event)
}

export function hideOverlay(): void {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide()
}

/** True while the frame is on screen - used to keep it out of screenshots. */
export function isOverlayVisible(): boolean {
  return Boolean(win && !win.isDestroyed() && win.isVisible())
}
