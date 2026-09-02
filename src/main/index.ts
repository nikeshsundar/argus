import { app, ipcMain } from 'electron'
import { runAgentTask } from './agentLoop'
import { inferProviderFromKey } from '../shared/keys'
import type { SubmitResult, Thread, ThreadSummary, Turn } from '../shared/types'
import { clearThreads, createThread, getThread, listThreads, saveThread } from './history'
import { parseMode, type Mode } from '../shared/types'
import { parseTeachRequest } from '../shared/teach'
import { runTeachLesson } from './teachLoop'
import { disposeHotkeys, hotkeyStrategy, registerHotkey, watchEscape } from './hotkey'
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
const HOTKEY_FALLBACKS = ['Super+`', 'Control+Shift+Space', 'Control+Alt+Space', 'F9']

/**
 * The screenshot taken when the bar was last opened. Held in memory only, and
 * cleared as soon as the request finishes or the bar is dismissed.
 */
let pendingCapture: Capture | null = null

/**
 * The conversation being added to. A fresh one starts with each capture; an
 * older one can be resumed from history, in which case the screenshot attaches
 * to the next question rather than to turn zero.
 */
let thread: Thread = createThread()
let imageAnchor = 0

/** In-flight model request, so a dismiss or a new question cancels the old one. */
let inFlight: AbortController | null = null

function clearPendingCapture(): void {
  pendingCapture = null
}

/**
 * Files the current conversation away and starts an empty one.
 *
 * Called whenever the bar opens on a new capture, so what the model remembers
 * always matches the transcript the user can see.
 */
function startNewThread(): void {
  saveThread(thread)
  thread = createThread()
  imageAnchor = 0
}

function abortInFlight(): void {
  inFlight?.abort()
  inFlight = null
}

/**
 * Escape closes the bar even when it doesn't have focus.
 *
 * Without this the bar can strand itself: it stays on top, no longer hides on
 * blur, and its own Escape handler only fires while the input is focused - so
 * after clicking into another window there was no way to dismiss it.
 */
let stopEscapeWatch: (() => void) | null = null

function watchForDismiss(): void {
  stopEscapeWatch?.()
  stopEscapeWatch = watchEscape(() => {
    if (!isRequestBarVisible()) return
    abortInFlight()
    clearPendingCapture()
    hideRequestBar()
  })
}

function stopWatchingForDismiss(): void {
  stopEscapeWatch?.()
  stopEscapeWatch = null
}

/**
 * Hotkey handler: capture the screen *before* showing our own UI, so the bar
 * never appears in the image the model sees.
 */
async function openRequestBar(notice?: string): Promise<void> {
  if (isRequestBarVisible()) {
    stopWatchingForDismiss()
    hideRequestBar()
    return
  }

  abortInFlight()

  try {
    pendingCapture = await captureActiveDisplay()
    startNewThread()
    showRequestBar({ capture: pendingCapture.info, notice })
  } catch (error) {
    clearPendingCapture()
    showRequestBar({
      capture: null,
      error: error instanceof Error ? error.message : 'Screen capture failed'
    })
  }

  watchForDismiss()
}

/**
 * Registers the configured hotkey, falling back through known-good
 * combinations so the app is never left with no way to open it.
 */
function setupHotkey(): string | null {
  const configured = loadSettings().hotkey
  for (const candidate of [configured, ...HOTKEY_FALLBACKS]) {
    if (!registerHotkey(candidate, () => void openRequestBar())) continue
    // Always write it back, so settings.json reflects the hotkey actually in
    // force rather than a superseded default that was migrated in memory.
    updateSettings({ hotkey: candidate })
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

  /** Files a key under the provider its own format identifies. */
  const saveKey = (value: string, target: ProviderName): void => {
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
  }

  const key = /^\/key\s+(\S+)$/i.exec(text)
  if (key) {
    const value = key[1]!
    // Route by key format so pasting a Gemini key while Claude is selected
    // doesn't quietly store it in the wrong slot.
    const target = inferProviderFromKey(value) ?? settings.talkProvider
    saveKey(value, target)
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

  // Agent and Teach share one model, separate from Talk's - they are tuned for
  // speed over depth, and the wrong one there costs seconds on every step.
  const agentModel = /^\/model\s+agent\s+(\S+)$/i.exec(text)
  if (agentModel) {
    const id = agentModel[1]!
    if (inferProviderFromKey(id)) return fail("That's an API key, not a model. Use \"/key\".")
    updateSettings({ agentModel: id })
    return ok(`Agent and Teach Mode now use ${id}.`)
  }

  const model = /^\/model\s+(\S+)$/i.exec(text)
  if (model) {
    const id = model[1]!
    // An API key stored as a model name is only discovered later, as a 400 from
    // the provider that names neither command. Catch it here instead.
    const looksLikeKey = inferProviderFromKey(id)
    if (looksLikeKey) {
      saveKey(id, looksLikeKey)
      return ok(`That's a ${looksLikeKey} API key, not a model — saved it as your key instead.`)
    }
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

  const cursor = /^\/cursor\s+(\w+)$/i.exec(text)
  if (cursor) {
    const pace = cursor[1]!.toLowerCase()
    if (pace !== 'instant' && pace !== 'natural' && pace !== 'demo') {
      return fail(`Unknown pace "${pace}". Try instant, natural or demo.`)
    }
    updateSettings({ cursorPace: pace })
    return ok(
      pace === 'instant'
        ? 'Pointer will jump straight to each target.'
        : `Pointer now moves at ${pace} pace, so you can watch it work.`
    )
  }

  if (/^\/forget$/i.test(text)) {
    clearThreads()
    return ok('Chat history deleted.')
  }

  if (/^\/help$/i.test(text)) {
    return ok(
      [
        `/key <api-key>        set the key for ${settings.talkProvider}`,
        '/provider <name>      claude or gemini',
        '/model <model-id>     Talk Mode model',
        '/model agent <id>     Agent + Teach model (fast one)',
        '/hotkey <combo>       e.g. Alt+`',
        '/cursor <pace>        instant, natural or demo',
        '/history              past chats',
        '/new                  start a fresh chat',
        '/forget               delete all saved chats',
        'agent <task>          take control of the machine'
      ].join('\n')
    )
  }

  return null
}

/** Turns a "teach me" request into a prompt that produces followable steps. */
function asLessonPrompt(topic: string): string {
  return [
    `Walk me through how to ${topic}, using what is on my screen right now.`,
    'Number each step. Name the exact button, menu or field I should use and where it is,',
    'and say in one line what each step does, so I could do it again without you.',
    'If I need to get somewhere else first, start there.'
  ].join(' ')
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
      history: thread.turns,
      imageAnchor,
      signal: controller.signal,
      onDelta: (delta) => {
        if (!controller.signal.aborted) bar?.webContents.send('argus:delta', delta)
      }
    })
    thread.turns.push({ role: 'user', text: prompt }, { role: 'model', text: answer })
    saveThread(thread)
    return { ok: true, mode: 'talk', message: answer || '(empty response)' }
  } finally {
    if (inFlight === controller) inFlight = null
  }
}

/**
 * Agent Mode: hand the machine over. The bar gets out of the way while the
 * agent works, then comes back with what happened.
 */
/**
 * Runs a guided lesson: the bar gets out of the way, the ghost cursor points at
 * the real UI, and the learner does the clicking.
 */
async function runTeach(topic: string): Promise<SubmitResult> {
  const bar = getRequestBar()
  clearPendingCapture()
  abortInFlight()

  const controller = new AbortController()
  inFlight = controller
  hideRequestBar()

  try {
    const result = await runTeachLesson({
      topic,
      signal: controller.signal,
      onStep: (step) =>
        bar?.webContents.send('argus:agent-step', {
          description: `${step.index}. ${step.title}`,
          index: step.index,
          max: step.index
        })
    })
    showRequestBar({ capture: null, notice: result.summary })
    return { ok: result.ok, mode: 'agent', message: result.summary }
  } catch (error) {
    const message =
      error instanceof ProviderUnavailableError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'The lesson could not start.'
    showRequestBar({ capture: null, notice: message })
    return { ok: false, mode: 'agent', message }
  } finally {
    if (inFlight === controller) inFlight = null
  }
}

async function runAgent(task: string): Promise<SubmitResult> {
  const bar = getRequestBar()
  clearPendingCapture()
  abortInFlight()

  const controller = new AbortController()
  inFlight = controller
  hideRequestBar()

  try {
    const result = await runAgentTask({
      task,
      signal: controller.signal,
      onStep: (event) => bar?.webContents.send('argus:agent-step', event)
    })
    showRequestBar({ capture: null, notice: result.summary })
    return { ok: result.ok, mode: 'agent', message: result.summary }
  } catch (error) {
    const message =
      error instanceof ProviderUnavailableError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Agent Mode failed.'
    showRequestBar({ capture: null, error: message })
    return { ok: false, mode: 'agent', message }
  } finally {
    if (inFlight === controller) inFlight = null
  }
}

function registerIpc(): void {
  ipcMain.handle('argus:submit', async (_event, text: string, forced?: Mode) => {
    const command = handleSlashCommand(text.trim())
    if (command) return command

    // A mode chosen with the chip beats what the wording looks like.
    const inferred = parseMode(text)
    const mode = forced ?? inferred.mode
    const prompt = forced ? text.trim() : inferred.prompt
    if (!prompt) {
      return { ok: false, mode, message: 'Say what you want me to look at.' }
    }

    // "teach me ..." is a modifier, not a mode: the chip still decides whether
    // that means written steps or a walkthrough pointed out on the real screen.
    const lesson = parseTeachRequest(prompt)
    if (lesson.teach && mode === 'agent') return await runTeach(lesson.topic)

    // In Talk Mode the same request becomes written steps. Spelling out the
    // shape here beats hoping "teach me" alone produces something followable.
    const asked = lesson.teach ? asLessonPrompt(lesson.topic) : prompt

    if (mode === 'agent') return await runAgent(prompt)

    // The capture is deliberately kept after answering: follow-up questions ask
    // about the same screen, and re-capturing would show our own bar instead.
    const capture = pendingCapture
    if (!capture) {
      return { ok: false, mode, message: 'No screen capture available for this request.' }
    }

    try {
      return await runTalkMode(asked, capture)
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
    stopWatchingForDismiss()
    abortInFlight()
    clearPendingCapture()
    saveThread(thread)
    hideRequestBar()
  })

  ipcMain.on('argus:resize', (_event, height: number) => resizeRequestBar(height))

  ipcMain.handle('argus:threads', (): ThreadSummary[] => listThreads())

  ipcMain.handle('argus:open-thread', (_event, id: string): Turn[] => {
    const saved = getThread(id)
    if (!saved) return []

    saveThread(thread) // don't lose whatever was in progress
    thread = saved
    // Stored turns carry no screenshot, so the live one goes on the next question.
    imageAnchor = saved.turns.length
    return saved.turns
  })

  ipcMain.handle('argus:new-thread', (): void => {
    saveThread(thread)
    thread = createThread()
    imageAnchor = 0
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

    const hotkey = setupHotkey()
    refreshTrayMenu({ onOpen: () => void openRequestBar() })
    console.log(
      hotkey
        ? `Argus ready - press ${hotkey} (via ${hotkeyStrategy()})`
        : 'Argus ready - no hotkey available'
    )

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
    saveThread(thread)
    disposeHotkeys()
    abortInFlight()
    clearPendingCapture()
  })
}
