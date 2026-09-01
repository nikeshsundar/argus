import { app, ipcMain } from 'electron'
import type { SubmitResult } from '../shared/types'
import { parseMode } from '../shared/types'
import { registerHotkey, unregisterHotkey } from './hotkey'
import { createRequestBar, hideRequestBar, isRequestBarVisible, showRequestBar } from './requestBar'
import { captureActiveDisplay, type Capture } from './screenshot'
import { loadSettings } from './settingsStore'
import { createTray } from './tray'

/**
 * The screenshot taken when the bar was last opened. Held in memory only, and
 * cleared as soon as the request finishes or the bar is dismissed.
 */
let pendingCapture: Capture | null = null

function clearPendingCapture(): void {
  pendingCapture = null
}

/**
 * Hotkey handler: capture the screen *before* showing our own UI, so the bar
 * never appears in the image the model sees.
 */
async function openRequestBar(): Promise<void> {
  if (isRequestBarVisible()) {
    hideRequestBar()
    return
  }

  try {
    pendingCapture = await captureActiveDisplay()
    showRequestBar({ capture: pendingCapture.info })
  } catch (error) {
    pendingCapture = null
    showRequestBar({
      capture: null,
      error: error instanceof Error ? error.message : 'Screen capture failed'
    })
  }
}

function registerIpc(): void {
  ipcMain.handle('argus:submit', async (_event, text: string): Promise<SubmitResult> => {
    const { mode, prompt } = parseMode(text)

    if (!prompt) {
      return { ok: false, mode, message: 'Say what you want me to look at.' }
    }

    // Phase 2: the capture pipeline is wired end to end, but no model is
    // connected yet - echo back what would be sent so the plumbing is testable.
    const capture = pendingCapture
    clearPendingCapture()

    if (!capture) {
      return { ok: false, mode, message: 'No screen capture available for this request.' }
    }

    return {
      ok: true,
      mode,
      message:
        `[${mode} mode] "${prompt}" - captured ${capture.info.width}x${capture.info.height} ` +
        `from display ${capture.info.displayId}. Model not connected yet.`
    }
  })

  ipcMain.on('argus:hide', () => {
    clearPendingCapture()
    hideRequestBar()
  })
}

// A second instance would fight over the global hotkey, so hand off to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => void openRequestBar())

  void app.whenReady().then(() => {
    createRequestBar()
    registerIpc()
    createTray({ onOpen: () => void openRequestBar() })

    const { hotkey } = loadSettings()
    if (!registerHotkey(hotkey, () => void openRequestBar())) {
      console.error(`Could not register hotkey "${hotkey}" - it may be taken by another app.`)
    }
  })

  // Tray app: closing the request bar must not quit the process.
  app.on('window-all-closed', () => {})
  app.on('will-quit', () => {
    unregisterHotkey()
    clearPendingCapture()
  })
}
