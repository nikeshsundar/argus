import { app, ipcMain, session } from 'electron'
import { runAgentTask } from './agentLoop'
import type { AgentAction, ScreenSize } from '../shared/agent'
import { parseKeyCommand } from '../shared/commands'
import { activeScreenSize, replayWorkflow } from './replay'
import { clearWorkflows, deleteWorkflow, listWorkflows, noteRun, saveWorkflow } from './workflowStore'
import {
  describeWorkflow,
  estimateMs,
  findWorkflow,
  formatDuration,
  nameProblem,
  normaliseName,
  parseWorkflowCommand,
  previewLines,
  recordable,
  screenDrifted,
  suggestNames,
  type Workflow
} from '../shared/workflow'
import { inferProviderFromKey } from '../shared/keys'
import { configuredKeys, forgetCooldowns, poolRows, poolStatus } from './geminiKeys'
import type { SubmitResult, Thread, ThreadSummary, Turn } from '../shared/types'
import { clearThreads, createThread, getThread, listThreads, saveThread } from './history'
import { parseMode, type Mode } from '../shared/types'
import { parseTeachRequest } from '../shared/teach'
import { runTeachLesson } from './teachLoop'
import { transcribe } from './transcribe'
import { disposeHotkeys, hotkeyStrategy, registerHotkey, watchEscape } from './hotkey'
import { createRecallProvider, createTalkProvider } from './providers'
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
import { isOverlayVisible } from './overlayWindow'
import {
  configureMemory,
  heldFrames,
  isRecording,
  memoryStatus,
  purgeMemory,
  retentionMinutes,
  setRetention,
  startMemory,
  stopMemory
} from './screenMemory'
import {
  clampWindow,
  describeMemory,
  DEFAULT_MINUTES,
  formatAge,
  frameLabel,
  lookbackMs,
  looksLikeRecall,
  MAX_MINUTES,
  MIN_MINUTES,
  parseMemoryCommand,
  selectFrames
} from '../shared/recall'
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

/**
 * The last Agent run that worked, held until the next one replaces it.
 *
 * Saving is offered after the fact rather than asked about beforehand, because
 * nobody knows a task is worth keeping until they have watched it succeed. In
 * memory only: an unsaved run is not worth surviving a restart, and the user
 * has not yet said they want it kept anywhere.
 */
let lastRun: { task: string; actions: AgentAction[]; screen: ScreenSize } | null = null

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
      case 'gemini': {
        // A new key goes to the FRONT of the queue. People add one because the
        // last one ran out, so putting it behind the exhausted key means every
        // request is spent rediscovering that - and the new key never gets a
        // turn until the old one has failed again.
        const settings = loadSettings()
        const rest = [settings.geminiApiKey, ...settings.geminiApiKeys].filter(
          (key) => key && key !== value
        )
        updateSettings({
          geminiApiKey: value,
          geminiApiKeys: rest,
          talkProvider: 'gemini'
        })
        break
      }
      case 'openai':
        updateSettings({ openaiApiKey: value, talkProvider: 'openai' })
        break
      default:
        updateSettings({ claudeApiKey: value, talkProvider: 'claude' })
    }
  }

  // "/key" and "/keys" are different commands and are parsed together, so the
  // singular can never shadow the plural and a near miss on either cannot fall
  // through to the model carrying a key with it.
  const keyCommand = parseKeyCommand(text)

  if (keyCommand.kind === 'add') {
    const value = keyCommand.key
    // Route by key format so pasting a Gemini key while Claude is selected
    // doesn't quietly store it in the wrong slot.
    const target = inferProviderFromKey(value) ?? settings.talkProvider
    if (target !== 'gemini') {
      return fail(
        `That looks like a ${target} key. Argus talks to Gemini right now — get a free one at aistudio.google.com/apikey.`
      )
    }
    saveKey(value, target)
    if (target === 'gemini') {
      const count = configuredKeys().length
      return ok(
        count > 1
          ? `Key saved — ${count} Gemini keys in rotation. If one runs out of quota the next takes over.`
          : 'Gemini API key saved. Ask away.'
      )
    }
    return ok(
      target === settings.talkProvider
        ? `${target} API key saved. Ask away.`
        : `Recognised a ${target} key — saved it and switched Talk Mode to ${target}.`
    )
  }

  if (keyCommand.kind === 'load') {
    if (keyCommand.keys.length === 0) {
      return fail(`None of those look like API keys (Gemini's start with "AIza" or "AQ.").`)
    }
    updateSettings({
      geminiApiKey: keyCommand.keys[0]!,
      geminiApiKeys: keyCommand.keys.slice(1),
      geminiKeyCooldowns: {},
      talkProvider: 'gemini'
    })
    forgetCooldowns()
    return ok(
      `Loaded ${keyCommand.keys.length} key${keyCommand.keys.length === 1 ? '' : 's'}.` +
        (keyCommand.ignored ? ` Ignored ${keyCommand.ignored} that weren't keys.` : '') +
        ' They are tried in the order given, and one over quota hands off to the next.'
    )
  }

  if (keyCommand.kind === 'reset') {
    forgetCooldowns()
    return ok('Cooldowns cleared — every key will be tried again.')
  }

  if (keyCommand.kind === 'list') {
    const keys = configuredKeys()
    if (keys.length === 0) return fail('No Gemini keys yet. Add one with "/key <your-key>".')
    return ok(
      [
        `${poolStatus()} — tried in this order:`,
        ...poolRows().map(
          (row, index) =>
            `  ${index + 1}. ${row.key.slice(0, 8)}…${row.key.slice(-4)}  — ${row.status}`
        ),
        '',
        'Quota is per Google Cloud project, so extra keys only add headroom',
        'if they come from different projects.',
        '',
        '/keys <k1> <k2> ...   load several at once',
        '/keys reset           clear cooldowns and retry every key',
        '/keys clear           remove them all'
      ].join('\n')
    )
  }

  if (keyCommand.kind === 'clear') {
    updateSettings({ geminiApiKey: '', geminiApiKeys: [], geminiKeyCooldowns: {} })
    return ok('All Gemini keys removed. Add one with "/key <your-key>".')
  }

  const provider = /^\/provider\s+(\w+)$/i.exec(text)
  if (provider) {
    const name = provider[1]!.toLowerCase() as ProviderName
    if (name !== 'gemini') {
      return fail(`Argus only talks to Gemini right now. Use "/provider gemini".`)
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
    refreshTray()
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
        `/key <api-key>        add a key for ${settings.talkProvider}`,
        '/keys                 list keys and rotation status',
        '/keys <k1> <k2> ...   load several keys at once',
        '/model <model-id>     Talk Mode model',
        '/model agent <id>     Agent + Teach model (fast one)',
        '/hotkey <combo>       e.g. Alt+`',
        '/cursor <pace>        instant, natural or demo',
        '/history              past chats',
        '/new                  start a fresh chat',
        '/forget               delete all saved chats',
        'agent <task>          take control of the machine',
        '/save <name>          keep the last Agent run',
        '/workflows            saved runs you can replay for free',
        '/run <name>           replay one, no model call',
        '/memory on            remember the last few minutes of screen',
        '/recall <question>    ask about something already gone',
        '/memory off           stop, and forget it all'
      ].join('\n')
    )
  }

  // Anything else beginning with "/" is a mistyped command, not a question. It
  // must not reach the model: a slip like "/ke <key>" would otherwise send the
  // key itself as a prompt, and put it in the saved transcript on the way.
  if (text.startsWith('/')) {
    const attempted = /^\/(\S*)/.exec(text)?.[1] ?? ''
    return fail(`Unknown command "/${attempted}". Type "/help" to see them all.`)
  }

  return null
}

/**
 * Everything to do with saved workflows.
 *
 * Handled before `handleSlashCommand` and separately from it, because "/run"
 * has to await a replay and that one is synchronous. Splitting it also keeps
 * the unknown-command guard honest: this function claims every "/save",
 * "/workflows" and "/run" - including malformed ones, which get a real
 * explanation rather than "unknown command".
 */
async function handleWorkflowCommand(text: string): Promise<SubmitResult | null> {
  const ok = (message: string): SubmitResult => ({ ok: true, mode: 'talk', message })
  const fail = (message: string): SubmitResult => ({ ok: false, mode: 'talk', message })

  const command = parseWorkflowCommand(text)
  if (command.kind === 'none') return null

  const saved = listWorkflows()

  /** An unknown name is usually a near miss, so say what does exist. */
  const unknown = (name: string): SubmitResult => {
    const near = suggestNames(name, saved)
    if (saved.length === 0) {
      return fail('Nothing saved yet. Run an Agent task, then "/save <name>".')
    }
    return fail(
      near.length > 0
        ? `No workflow called "${name}". Did you mean: ${near.join(', ')}?`
        : `No workflow called "${name}". Type "/workflows" to see them.`
    )
  }

  switch (command.kind) {
    case 'save': {
      if (!lastRun) {
        return fail('Nothing to save yet. Run an Agent task first, then "/save <name>".')
      }
      const problem = nameProblem(command.name)
      if (problem) return fail(problem)

      const actions = recordable(lastRun.actions)
      if (actions.length === 0) {
        return fail('That run finished without doing anything worth replaying.')
      }

      const name = command.name.trim()
      const replaced = saved.some((flow) => normaliseName(flow.name) === normaliseName(name))
      saveWorkflow({
        name,
        task: lastRun.task,
        actions,
        createdAt: Date.now(),
        runs: 0,
        screen: lastRun.screen
      })

      const eta = formatDuration(estimateMs(actions, loadSettings().cursorPace, lastRun.screen))
      return ok(
        `${replaced ? 'Replaced' : 'Saved'} "${name}" — ${actions.length} steps, ${eta} to replay with no model calls.\nType "${name}" in Agent Mode, or "/run ${name}".`
      )
    }

    case 'list': {
      if (saved.length === 0) {
        return ok(
          'No saved workflows yet.\nRun an Agent task, then "/save <name>" to keep it — replaying costs nothing.'
        )
      }
      return ok(
        [
          `${saved.length} saved:`,
          ...saved.map((flow) => `  ${describeWorkflow(flow)}`),
          '',
          '/run <name>              replay one',
          '/workflows <name>        show its steps first',
          '/workflows delete <name> remove one'
        ].join('\n')
      )
    }

    case 'show': {
      const flow = findWorkflow(command.name, saved)
      if (!flow) return unknown(command.name)
      const eta = formatDuration(estimateMs(flow.actions, loadSettings().cursorPace, flow.screen))
      return ok(
        [
          `${flow.name} — "${flow.task}"`,
          ...previewLines(flow),
          '',
          `${eta}, no model calls. Run it with "/run ${flow.name}".`
        ].join('\n')
      )
    }

    case 'delete': {
      const flow = findWorkflow(command.name, saved)
      if (!flow) return unknown(command.name)
      deleteWorkflow(flow.name)
      return ok(`Deleted "${flow.name}".`)
    }

    case 'clear': {
      const count = clearWorkflows()
      return ok(count === 0 ? 'There were none to remove.' : `Removed all ${count} workflows.`)
    }

    case 'run': {
      if (!command.name) return fail('Which one? "/run <name>" — type "/workflows" to see them.')
      const flow = findWorkflow(command.name, saved)
      if (!flow) return unknown(command.name)
      return await runReplay(flow)
    }
  }
}

/**
 * Everything to do with screen memory.
 *
 * Async and separate from `handleSlashCommand` for the same reason the
 * workflow commands are: "/recall" has to await a model call, and the
 * unknown-command guard at the end of that function is synchronous. Every
 * "/memory" and "/recall" is claimed here, malformed ones included, so a typo
 * gets an explanation instead of "unknown command".
 */
async function handleMemoryCommand(text: string): Promise<SubmitResult | null> {
  const ok = (message: string): SubmitResult => ({ ok: true, mode: 'talk', message })
  const fail = (message: string): SubmitResult => ({ ok: false, mode: 'talk', message })

  const command = parseMemoryCommand(text)
  if (command.kind === 'none') return null

  switch (command.kind) {
    case 'status':
      return ok(describeMemory(memoryStatus(), Date.now()))

    case 'on': {
      if (command.raw && command.minutes === null) {
        return fail(
          `"${command.raw}" isn't a length. Try "/memory on 10" — anything from ${MIN_MINUTES} to ${MAX_MINUTES} minutes.`
        )
      }

      const minutes = command.minutes ?? loadSettings().memoryMinutes ?? DEFAULT_MINUTES
      updateSettings({ memoryEnabled: true, memoryMinutes: minutes })
      setRetention(minutes)
      startMemory(minutes)
      refreshTray()

      return ok(
        [
          `Screen memory on — keeping the last ${minutes} minutes.`,
          '',
          'Frames live in RAM and are never written to disk. Argus stops recording',
          'while this bar is open or the agent is running, and forgets everything the',
          'moment you type "/memory off".',
          '',
          'Ask about something already gone: /recall what was that error'
        ].join('\n')
      )
    }

    case 'off': {
      const forgotten = stopMemory()
      updateSettings({ memoryEnabled: false })
      refreshTray()
      return ok(
        forgotten === 0
          ? 'Screen memory off. Nothing was being kept.'
          : `Screen memory off — ${forgotten} remembered moment${forgotten === 1 ? '' : 's'} forgotten.`
      )
    }

    case 'purge': {
      const forgotten = purgeMemory()
      return ok(
        forgotten === 0
          ? 'There was nothing to forget.'
          : `Forgot ${forgotten} remembered moment${forgotten === 1 ? '' : 's'}.` +
              (isRecording() ? ' Still recording from here on — "/memory off" to stop.' : '')
      )
    }

    case 'ask': {
      if (!command.question) {
        return fail('Ask it something: "/recall what was that error code".')
      }
      return await runRecall(command.question)
    }

    default:
      return fail(
        `I don't know "/memory ${command.raw}". Try "/memory on", "/memory off", "/memory purge", or "/memory" on its own.`
      )
  }
}

/**
 * Answers a question about the recent past.
 *
 * The live screen goes on the end of the timeline whenever there is one, so
 * "what changed since I opened this" and "is that error still up" have a now to
 * compare against. Nothing is sent until this point: recording alone never
 * leaves the machine.
 */
async function runRecall(question: string): Promise<SubmitResult> {
  const fail = (message: string): SubmitResult => ({ ok: false, mode: 'talk', message })

  if (!isRecording() && heldFrames().length === 0) {
    return fail(
      [
        'Screen memory is off, so there is nothing to look back through.',
        'Turn it on with "/memory on" and Argus will keep the last',
        `${loadSettings().memoryMinutes} minutes of your screen in RAM.`
      ].join(' ')
    )
  }

  const now = Date.now()
  const retentionMs = retentionMinutes() * 60_000
  const windowMs = clampWindow(lookbackMs(question), retentionMs)
  const chosen = selectFrames(heldFrames(), { now, windowMs })

  if (chosen.length === 0) {
    const status = memoryStatus()
    return fail(
      status.frames === 0
        ? 'Nothing has been recorded yet — give it a few seconds of screen time and ask again.'
        : `Nothing that far back. The oldest thing I have is from ${formatAge(now - status.oldestAt!)}.`
    )
  }

  const provider = createRecallProvider()
  const bar = getRequestBar()

  abortInFlight()
  const controller = new AbortController()
  inFlight = controller

  const frames = chosen.map((frame) => ({
    jpeg: frame.jpeg,
    label: frameLabel(frame, now)
  }))

  // The screen as it is right now, captured before the bar opened.
  if (pendingCapture) {
    frames.push({ jpeg: pendingCapture.model.png, label: '[the screen right now]' })
  }

  try {
    const answer = await provider.ask({
      question,
      frames,
      signal: controller.signal,
      onDelta: (delta) => {
        if (!controller.signal.aborted) bar?.webContents.send('argus:delta', delta)
      }
    })

    // Recorded in the transcript like any other exchange, so a follow-up can
    // refer back to it - and so the user can see later what they asked.
    thread.turns.push({ role: 'user', text: question }, { role: 'model', text: answer })
    saveThread(thread)

    const searched = `\n\n— from ${chosen.length} frame${chosen.length === 1 ? '' : 's'} of the last ${Math.round(windowMs / 60_000) || 1} min`
    return { ok: true, mode: 'talk', message: (answer || '(empty response)') + searched }
  } catch (error) {
    if (error instanceof ProviderUnavailableError) return fail(error.message)
    return fail(error instanceof Error ? error.message : 'Could not search screen memory.')
  } finally {
    if (inFlight === controller) inFlight = null
  }
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
/**
 * Reopens the bar after an Agent or Teach run with a usable screenshot.
 *
 * Those runs clear the pending capture and the screen has moved on anyway, so
 * showing the bar without one left the next Talk question with nothing to look
 * at - "No screen capture available for this request". The bar is still hidden
 * at this point, which is the only moment a capture can be taken without our
 * own window being in it.
 */
async function reopenAfterRun(notice: string, failed: boolean): Promise<void> {
  try {
    pendingCapture = await captureActiveDisplay()
    showRequestBar({ capture: pendingCapture.info, ...(failed ? { error: notice } : { notice }) })
  } catch {
    clearPendingCapture()
    showRequestBar({ capture: null, ...(failed ? { error: notice } : { notice }) })
  }
}

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
    await reopenAfterRun(result.summary, !result.ok)
    return { ok: result.ok, mode: 'agent', message: result.summary }
  } catch (error) {
    const message =
      error instanceof ProviderUnavailableError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'The lesson could not start.'
    await reopenAfterRun(message, true)
    return { ok: false, mode: 'agent', message }
  } finally {
    if (inFlight === controller) inFlight = null
  }
}

/**
 * Replays a saved workflow. Same overlay and same Escape as Agent Mode, with
 * nothing to think about - so it costs no quota and finishes in seconds.
 */
async function runReplay(flow: Workflow): Promise<SubmitResult> {
  const current = activeScreenSize()
  if (screenDrifted(flow.screen, current)) {
    return {
      ok: false,
      mode: 'agent',
      message:
        `"${flow.name}" was recorded on a ${flow.screen.width}×${flow.screen.height} screen and this one is ` +
        `${current.width}×${current.height}. A replay clicks fixed positions with nothing watching, so on a ` +
        `differently shaped screen it would land in the wrong places. Run the task in Agent Mode and save it again.`
    }
  }

  const bar = getRequestBar()
  clearPendingCapture()
  abortInFlight()

  const controller = new AbortController()
  inFlight = controller
  hideRequestBar()

  try {
    const result = await replayWorkflow({
      workflow: flow,
      signal: controller.signal,
      onStep: (event) => bar?.webContents.send('argus:agent-step', event)
    })
    if (result.ok) noteRun(flow.name)
    await reopenAfterRun(result.summary, !result.ok)
    return { ok: result.ok, mode: 'agent', message: result.summary }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The replay could not start.'
    await reopenAfterRun(message, true)
    return { ok: false, mode: 'agent', message }
  } finally {
    if (inFlight === controller) inFlight = null
  }
}

async function runAgent(task: string): Promise<SubmitResult> {
  const bar = getRequestBar()
  // Taken before the bar is hidden and before anything moves, so a saved
  // workflow records the screen the coordinates actually refer to.
  const screen = activeScreenSize()
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
    const worthKeeping = result.ok && recordable(result.actions).length > 0
    lastRun = worthKeeping ? { task, actions: result.actions, screen } : null
    const notice = worthKeeping
      ? `${result.summary}\n\nSave it with "/save <name>" and it replays instantly next time, without a model call.`
      : result.summary
    await reopenAfterRun(notice, !result.ok)
    return { ok: result.ok, mode: 'agent', message: notice }
  } catch (error) {
    const message =
      error instanceof ProviderUnavailableError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Agent Mode failed.'
    await reopenAfterRun(message, true)
    return { ok: false, mode: 'agent', message }
  } finally {
    if (inFlight === controller) inFlight = null
  }
}

/**
 * Electron refuses getUserMedia unless the session allows it, and refuses it
 * silently - the renderer sees the same failure as a machine with no
 * microphone. Only the microphone is granted, and only to our own pages.
 */
function allowMicrophone(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media')
  })

  // Consulted synchronously, and separately from the request handler above.
  // Left unset it denies, and getUserMedia then fails before the request
  // handler is ever reached - looking exactly like a machine with no mic.
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => {
    return permission === 'media'
  })
}

function registerIpc(): void {
  ipcMain.handle('argus:transcribe', async (_event, wav: ArrayBuffer): Promise<string> => {
    return await transcribe(Buffer.from(wav))
  })

  ipcMain.handle('argus:submit', async (_event, text: string, forced?: Mode) => {
    // Workflows are handled first: "/run" has to await a replay, and the
    // unknown-command guard at the end of handleSlashCommand would otherwise
    // reject every one of these before they were understood.
    const flowCommand = await handleWorkflowCommand(text.trim())
    if (flowCommand) return flowCommand

    const memoryCommand = await handleMemoryCommand(text.trim())
    if (memoryCommand) return memoryCommand

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

    if (mode === 'agent') {
      // The name of a saved workflow, typed on its own, replays it. Only an
      // exact match counts: a prefix would mean "gi" quietly carrying out
      // whichever of "git push" and "gimp export" happened to be found first.
      const named = listWorkflows().find(
        (flow) => normaliseName(flow.name) === normaliseName(prompt)
      )
      if (named) return await runReplay(named)
      return await runAgent(prompt)
    }

    // The capture is deliberately kept after answering: follow-up questions ask
    // about the same screen, and re-capturing would show our own bar instead.
    // A question about something already gone is answered from the timeline
    // instead of from the one screen in front of us. Only while recording, and
    // only for wordings that cannot be about the live screen - see
    // `looksLikeRecall`, which errs towards leaving questions alone.
    if (isRecording() && looksLikeRecall(asked)) return await runRecall(asked)

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

/** Rebuilds the tray menu, which shows the recorder's state and switches it. */
function refreshTray(): void {
  refreshTrayMenu({
    onOpen: () => void openRequestBar(),
    onToggleMemory: () => void toggleMemory(),
    onPurgeMemory: () => {
      purgeMemory()
      refreshTray()
    }
  })
}

/** The tray's switch. Same effect as "/memory on" and "/memory off". */
function toggleMemory(): void {
  if (isRecording()) {
    stopMemory()
    updateSettings({ memoryEnabled: false })
  } else {
    const minutes = loadSettings().memoryMinutes || DEFAULT_MINUTES
    setRetention(minutes)
    startMemory(minutes)
    updateSettings({ memoryEnabled: true, memoryMinutes: minutes })
  }
  refreshTray()
}

// A second instance would fight over the global hotkey, so hand off to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => void openRequestBar())

  void app.whenReady().then(() => {
    createRequestBar()
    allowMicrophone()
    registerIpc()

    // The recorder keeps its eyes shut while any of our own windows are up. A
    // buffer full of Argus's UI answers nothing, and the bar is where the user
    // types - including, sometimes, an API key.
    configureMemory({
      shouldSkip: () => isRequestBarVisible() || isOverlayVisible() || inFlight !== null
    })

    createTray({
      onOpen: () => void openRequestBar(),
      onToggleMemory: () => void toggleMemory(),
      onPurgeMemory: () => {
        purgeMemory()
        refreshTray()
      }
    })

    const hotkey = setupHotkey()

    // Recording survives a restart because the flag does, not because any
    // frame does: the buffer always starts empty.
    const settings = loadSettings()
    if (settings.memoryEnabled) startMemory(settings.memoryMinutes || DEFAULT_MINUTES)

    refreshTray()
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
    // Whatever was remembered dies with the process. Nothing to flush.
    stopMemory()
    saveThread(thread)
    disposeHotkeys()
    abortInFlight()
    clearPendingCapture()
  })
}
