import { app, ipcMain } from 'electron'
import { inferProviderFromKey } from '../shared/keys'
import type { SubmitResult } from '../shared/types'
import { parseMode } from '../shared/types'
import { registerHotkey, unregisterHotkey } from './hotkey'
import { createTalkProvider } from './providers'
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
import { isProviderConfigured, loadSettings, updateSettings, type ProviderName } from './settingsStore'
import { createTray, refreshTrayMenu } from './tray'

/**
 * Tried in order when the configured hotkey can't be registered - usually
 * because another app (or Windows itself) already owns that combination.
 */
const HOTKEY_FALLBACKS = ['Control+Shift+Space', 'Control+Alt+Space', 'Control+Shift+A', 'F9']

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
async function openRequestBar(notice?: string): Promise<void> {
  if (isRequestBarVisible()) {
    hideRequestBar()
    return
  }

  abortInFlight()

  try {
    pendingCapture = await captureActiveDisplay()
    showRequestBar({ capture: pendingCapture.info, notice })
  } catch (error) {
    clearPendingCapture()
    showRequestBar({
      capture: null,
      error: error instanceof Error ? error.message : 'Screen capture failed'
    })
  }
}

/**
 * Registers the configured hotkey, falling back through known-good
 * combinations so the app is never left with no way to open it.
 */
function setupHotkey(): string | null {
  const configured = loadSettings().hotkey
  for (const candidate of [configured, ...HOTKEY_FALLBACKS]) {
    if (!registerHotkey(candidate, () => void openRequestBar())) continue
    if (candidate !== configured) updateSettings({ hotkey: candidate })
    return candidate
  }
  return null
}

/**
 * Slash commands keep setup inside the bar itself, so there's no settings
 * window to build before the app is usable.
 */
function handleSlashCommand(text: string): SubmitResult | null {
  const settings = loadSettings()
  const ok = (message: string): SubmitResult => ({ ok: true, mode: 'talk', message })
  const fail = (message: string): SubmitResult => ({ ok: false, mode: 'talk', message })

  const key = /^\/key\s+(\S+)$/i.exec(text)
  if (key) {
    const value = key[1]!
    // Route by key format so pasting a Gemini key while Claude is selected
    // doesn't quietly store it in the wrong slot.
    const target = inferProviderFromKey(value) ?? settings.talkProvider
    switch (target) {
      case 'gemini':
        updateSettings({ geminiApiKey: value, talkProvider: 'gemini' })
        break
      case 'openai':
        updateSettings({ openaiApiKey: value, talkProvider: 'openai' })
        break
      default:
        updateSettings({ claudeApiKey: value, talkProvider: 'claude' })
    }
    return ok(
      target === settings.talkProvider
        ? `${target} API key saved. Ask away.`
        : `Recognised a ${target} key — saved it and switched Talk Mode to ${target}.`
    )
  }

  const provider = /^\/provider\s+(\w+)$/i.exec(text)
  if (provider) {
    const name = provider[1]!.toLowerCase() as ProviderName
    if (!['claude', 'gemini', 'openai', 'ollama'].includes(name)) {
      return fail(`Unknown provider "${name}". Try claude or gemini.`)
    }
    updateSettings({ talkProvider: name })
    return ok(
      isProviderConfigured(loadSettings())
        ? `Talk Mode now uses ${name}.`
        : `Talk Mode now uses ${name}. Add a key with "/key <your-key>".`
    )
  }

  const model = /^\/model\s+(\S+)$/i.exec(text)
  if (model) {
    const id = model[1]!
    updateSettings(settings.talkProvider === 'gemini' ? { geminiModel: id } : { claudeModel: id })
    return ok(`${settings.talkProvider} model set to ${id}.`)
  }

  const hotkey = /^\/hotkey\s+(\S+)$/i.exec(text)
  if (hotkey) {
    const accelerator = hotkey[1]!
    if (!registerHotkey(accelerator, () => void openRequestBar())) {
      setupHotkey()
      return fail(`Windows wouldn't give up "${accelerator}". Still using ${loadSettings().hotkey}.`)
    }
    updateSettings({ hotkey: accelerator })
    refreshTrayMenu({ onOpen: () => void openRequestBar() })
    return ok(`Hotkey is now ${accelerator}.`)
  }

  if (/^\/help$/i.test(text)) {
    return ok(
      [
        `/key <api-key>        set the key for ${settings.talkProvider}`,
        '/provider <name>      claude or gemini',
        '/model <model-id>     change the model',
        '/hotkey <combo>       e.g. Control+Shift+Space',
        'agent <task>          take action (not wired up yet)'
      ].join('\n')
    )
  }

  return null
}

async function runTalkMode(prompt: string, capture: Capture): Promise<SubmitResult> {
  const provider = createTalkProvider()
  const bar = getRequestBar()

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
    return { ok: true, mode: 'talk', message: answer || '(empty response)' }
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

    const hotkey = setupHotkey()
    refreshTrayMenu({ onOpen: () => void openRequestBar() })

    // Show the bar once on first run, otherwise a tray-only app looks like it
    // never started. Also the only place the active hotkey gets announced.
    if (!isProviderConfigured()) {
      void openRequestBar(
        hotkey
          ? `Argus is running. Press ${hotkey} anywhere to open this.\nAdd a key to start: /key <your-key>   (or /provider gemini first)`
          : 'Argus is running, but no hotkey could be registered. Open it from the tray icon, or set one with "/hotkey <combo>".'
      )
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
