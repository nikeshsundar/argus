import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { anchorToCursor, fitsOnDisplay } from '../shared/anchor'
import type { MemoryIndicator, OpenedEvent } from '../shared/types'
import { isRecording, retentionMinutes } from './screenMemory'

const WIDTH = 660
const HEIGHT = 190

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

/**
 * Height the content needed last time. Reopening at the default would show a
 * clipped bar until the renderer measured itself again.
 */
let lastContentHeight = HEIGHT

/** Moves the bar onto the display the cursor is on, then shows and focuses it. */
export function showRequestBar(payload: OpenedEvent): void {
  if (!win || win.isDestroyed()) return

  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const panel = { width: WIDTH, height: lastContentHeight }

  // A position the user chose by dragging outranks anything computed. Opening
  // somewhere else every time would be overriding them, which is worse than
  // never having anchored to the pointer in the first place.
  const parked = lastPosition !== null && fitsOnDisplay(lastPosition, panel, workArea)

  // Otherwise: beside the pointer. You press the hotkey looking at the thing
  // you are asking about, so that is where the answer should arrive - a fixed
  // spot a quarter of the way down the screen costs a glance across the
  // display and back on every single question.
  const position = parked
    ? lastPosition!
    : anchorToCursor({ cursor, panel, bounds: workArea })

  win.setBounds({
    x: Math.round(position.x),
    y: Math.round(position.y),
    width: WIDTH,
    height: lastContentHeight
  })

  win.showInactive()
  win.focus()
  // The recording indicator is attached here rather than by each caller, so
  // there is no way to open the bar without it: a screen recorder that is only
  // sometimes advertised is worse than one that never is.
  win.webContents.send('argus:opened', { ...payload, memory: memoryIndicator() })
}

/**
 * Grows or shrinks the bar to fit its content, so a one-line answer doesn't sit
 * in a tall empty panel and a longer one isn't clipped.
 */
export function resizeRequestBar(contentHeight: number): void {
  if (!win || win.isDestroyed()) return

  const { bounds } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const maxHeight = Math.round(bounds.height * 0.85)
  const height = Math.min(Math.max(Math.round(contentHeight), HEIGHT), maxHeight)
  lastContentHeight = height

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

/** What the bar's recording pill shows. */
function memoryIndicator(): MemoryIndicator {
  const recording = isRecording()
  return { recording, label: recording ? `${retentionMinutes()}m` : '' }
}
