import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { OpenedEvent } from '../shared/types'

const WIDTH = 660
const HEIGHT = 190
/** How far down the display the bar sits, as a fraction of screen height. */
const VERTICAL_ANCHOR = 0.24

let win: BrowserWindow | null = null

export function createRequestBar(): BrowserWindow {
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 'screen-saver' keeps the bar above fullscreen apps and other always-on-top windows.
  win.setAlwaysOnTop(true, 'screen-saver')

  // Dismiss when the user clicks away, the same way Spotlight/Raycast behave.
  // Skipped while DevTools is open, otherwise the bar vanishes as soon as you
  // click into DevTools during development.
  win.on('blur', () => {
    if (!win?.webContents.isDevToolsOpened()) hideRequestBar()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** Moves the bar onto the display the cursor is on, then shows and focuses it. */
export function showRequestBar(payload: OpenedEvent): void {
  if (!win || win.isDestroyed()) return

  const cursor = screen.getCursorScreenPoint()
  const { bounds } = screen.getDisplayNearestPoint(cursor)
  win.setBounds({
    x: Math.round(bounds.x + (bounds.width - WIDTH) / 2),
    y: Math.round(bounds.y + bounds.height * VERTICAL_ANCHOR),
    width: WIDTH,
    height: HEIGHT
  })

  win.showInactive()
  win.focus()
  win.webContents.send('argus:opened', payload)
}

export function hideRequestBar(): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  win.hide()
}

export function isRequestBarVisible(): boolean {
  return Boolean(win && !win.isDestroyed() && win.isVisible())
}

export function getRequestBar(): BrowserWindow | null {
  return win
}
