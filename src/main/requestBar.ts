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
    // Draggable, so it can be parked anywhere rather than always sitting in
    // the middle of whatever the user is reading.
    movable: true,
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

  // Deliberately no hide-on-blur. Answers are meant to be read while working in
  // another window, so the bar closes only on an explicit dismiss: the × button,
  // Escape twice, or the hotkey.

  win.on('moved', () => {
    if (!win || win.isDestroyed()) return
    const { x, y } = win.getBounds()
    lastPosition = { x, y }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** Where the user last dragged the bar, so it reopens where they left it. */
let lastPosition: { x: number; y: number } | null = null

/** Moves the bar onto the display the cursor is on, then shows and focuses it. */
export function showRequestBar(payload: OpenedEvent): void {
  if (!win || win.isDestroyed()) return

  const cursor = screen.getCursorScreenPoint()
  const { bounds } = screen.getDisplayNearestPoint(cursor)

  const onThisDisplay =
    lastPosition !== null &&
    lastPosition.x >= bounds.x &&
    lastPosition.x + WIDTH <= bounds.x + bounds.width &&
    lastPosition.y >= bounds.y &&
    lastPosition.y + HEIGHT <= bounds.y + bounds.height

  const position = onThisDisplay
    ? lastPosition!
    : {
        x: Math.round(bounds.x + (bounds.width - WIDTH) / 2),
        y: Math.round(bounds.y + bounds.height * VERTICAL_ANCHOR)
      }

  win.setBounds({ ...position, width: WIDTH, height: HEIGHT })

  win.showInactive()
  win.focus()
  win.webContents.send('argus:opened', payload)
}

/**
 * Grows or shrinks the bar to fit its content, so a one-line answer doesn't sit
 * in a tall empty panel and a longer one isn't clipped.
 */
export function resizeRequestBar(contentHeight: number): void {
  if (!win || win.isDestroyed()) return

  const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const maxHeight = Math.round(bounds.height * 0.7)
  const height = Math.min(Math.max(Math.round(contentHeight), HEIGHT), maxHeight)

  const current = win.getBounds()
  if (current.height === height) return
  win.setBounds({ ...current, height })
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
