import { app, ipcMain } from 'electron'
import type { SubmitResult } from '../shared/types'
import { parseMode } from '../shared/types'
import { registerHotkey, unregisterHotkey } from './hotkey'
import { createClaudeProvider } from './providers/claude'
import { ProviderUnavailableError } from './providers/types'
import {
  createRequestBar,
  getRequestBar,
  hideRequestBar,
  isRequestBarVisible,
  resizeRequestBar,
  showRequestBar
} from './requestBar'
import { captureActiveDisplay, type Capture } from './screenshot'
import { loadSettings, updateSettings } from './settingsStore'
import { createTray } from './tray'

/**
 * The screenshot taken when the bar was last opened. Held in memory only, and
 * cleared as soon as the request finishes or the bar is dismissed.
 */
let pendingCapture: Capture | null = null

/** In-flight model request, so a dismiss or a new question cancels the old one. */
let inFlight: AbortController | null = null

function clearPendingCapture(): void {
  pendingCapture = null
}

function abortInFlight(): void {
  inFlight?.abort()
  inFlight = null
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

  abortInFlight()

  try {
    pendingCapture = await captureActiveDisplay()
    showRequestBar({ capture: pendingCapture.info })
  } catch (error) {
    clearPendingCapture()
    showRequestBar({
      capture: null,
      error: error instanceof Error ? error.message : 'Screen capture failed'
    })
  }
}

/**
 * Slash commands keep first-run setup inside the bar itself, so there's no
 * settings window to build before the app is usable.
 */
function handleSlashCommand(text: string): SubmitResult | null {
  const key = /^\/key\s+(\S+)$/i.exec(text)
  if (key) {
    updateSettings({ claudeApiKey: key[1]! })
    return { ok: true, mode: 'talk', message: 'Claude API key saved. Ask away.' }
  }

  const model = /^\/model\s+(\S+)$/i.exec(text)
  if (model) {
    updateSettings({ claudeModel: model[1]! })
    return { ok: true, mode: 'talk', message: `Model set to ${model[1]}.` }
  }

  if (/^\/help$/i.test(text)) {
    return {
      ok: true,
      mode: 'talk',
      message: '/key <api-key> · /model <model-id> · start a request with "agent" to take action'
    }
  }

  return null
}

async function runTalkMode(prompt: string, capture: Capture): Promise<SubmitResult> {
  const settings = loadSettings()
  const bar = getRequestBar()

  const provider = createClaudeProvider({
    // An env var is handy in development; the saved key is what ships.
    apiKey: settings.claudeApiKey || process.env['ANTHROPIC_API_KEY'] || '',
    model: settings.claudeModel
  })

  abortInFlight()
  const controller = new AbortController()
  inFlight = controller

  try {
    const answer = await provider.ask({
      prompt,
      image: capture.model.png,
      signal: controller.signal,
      onDelta: (delta) => {
        if (!controller.signal.aborted) bar?.webContents.send('argus:delta', delta)
      }
    })
    return { ok: true, mode: 'talk', message: answer }
  } finally {
    if (inFlight === controller) inFlight = null
  }
}

function registerIpc(): void {
  ipcMain.handle('argus:submit', async (_event, text: string): Promise<SubmitResult> => {
    const command = handleSlashCommand(text.trim())
    if (command) return command

    const { mode, prompt } = parseMode(text)
    if (!prompt) {
      return { ok: false, mode, message: 'Say what you want me to look at.' }
    }

    if (mode === 'agent') {
      return {
        ok: false,
        mode,
        message: 'Agent Mode is not wired up yet - it lands in the next milestone.'
      }
    }

    const capture = pendingCapture
    clearPendingCapture()
    if (!capture) {
      return { ok: false, mode, message: 'No screen capture available for this request.' }
    }

    try {
      return await runTalkMode(prompt, capture)
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        return { ok: false, mode, message: error.message }
      }
      return {
        ok: false,
        mode,
        message: error instanceof Error ? error.message : 'Something went wrong.'
      }
    }
  })

  ipcMain.on('argus:hide', () => {
    abortInFlight()
    clearPendingCapture()
    hideRequestBar()
  })

  ipcMain.on('argus:resize', (_event, height: number) => resizeRequestBar(height))
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
    abortInFlight()
    clearPendingCapture()
  })
}
