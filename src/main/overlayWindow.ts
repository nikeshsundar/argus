import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import type { TeachStep } from '../shared/teach'
import type {
  AgentCursorEvent,
  AgentStepEvent,
  ApprovalDecision,
  ApprovalRequest,
  OverlayKind,
  TeachStepEvent,
  TodoItem
} from '../shared/types'
import { setOverlayInteractiveState } from './overlayState'
import { agentIsActing } from './userPresence'

let win: BrowserWindow | null = null
let overlayReady = false
let overlayRequested = false
let overlayKind: OverlayKind = 'agent'

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
  // Never intercept the user's clicks - they must stay in control of the
  // machine. `forward` still delivers mouse moves, which is how the to-do
  // pill and the approval card know the pointer has come onto them.
  win.setIgnoreMouseEvents(true, { forward: true })

  win.webContents.once('did-finish-load', () => {
    overlayReady = true
    win?.webContents.send('argus:overlay-kind', overlayKind)
    if (overlayRequested && win && !win.isDestroyed()) win.showInactive()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  return win
}

/**
 * `kind` decides how alarming the frame looks. Agent Mode is amber and says the
 * machine is being driven; Teach Mode is blue and says nothing will move on its
 * own - the difference matters, because only one of them takes the mouse.
 */
export function showOverlay(kind: OverlayKind = 'agent'): void {
  const overlay = ensureOverlay()
  overlayKind = kind
  overlayRequested = true
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  origin = { x: display.bounds.x, y: display.bounds.y }
  scaleFactor = display.scaleFactor
  overlay.setBounds(display.bounds)
  if (overlayReady) {
    overlay.webContents.send('argus:overlay-kind', kind)
    overlay.showInactive()
  }
}

/** Places the ghost cursor and its caption. `target` is in physical pixels. */
export function updateTeachStep(step: TeachStep, target: { x: number; y: number }): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('argus:teach-step', {
    step,
    x: target.x / scaleFactor - origin.x,
    y: target.y / scaleFactor - origin.y
  } satisfies TeachStepEvent)
}

/** Takes the ghost cursor off screen - before a capture, and when the lesson ends. */
export function clearTeachStep(): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('argus:teach-step', null)
}

/** A passing note in the banner - "retrying" and the like - with no step count. */
export function noteOverlay(text: string): void {
  updateOverlay({ description: text, index: 0, max: 0 })
}

export function updateOverlay(event: AgentStepEvent): void {
  if (overlayReady && win && !win.isDestroyed()) win.webContents.send('argus:agent-step', event)
}

/**
 * Streams the pointer to the overlay so it can draw a halo around it.
 *
 * Skipped while the overlay is hidden - which is exactly when a screenshot is
 * being taken, keeping our own decoration out of what the model reads.
 */
export function reportCursor(x: number, y: number, phase: AgentCursorEvent['phase']): void {
  if (!overlayReady || !win || win.isDestroyed() || !win.isVisible()) return
  win.webContents.send('argus:agent-cursor', {
    x: x / scaleFactor - origin.x,
    y: y / scaleFactor - origin.y,
    phase
  } satisfies AgentCursorEvent)
}

/**
 * Switches the frame between "the machine is being driven" and "you have
 * control". Pass null to go back to driving.
 *
 * A different colour, not just different words: the frame is the one thing
 * telling someone whether their next click will collide with the agent's.
 */
export function setOverlayPaused(text: string | null): void {
  if (overlayReady && win && !win.isDestroyed()) win.webContents.send('argus:overlay-paused', text)
}

export function hideOverlay(): void {
  overlayRequested = false
  // A hidden overlay must come back click-through, whatever the pointer was
  // over when it went.
  setOverlayInteractiveState(false)
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true })
  if (win && !win.isDestroyed() && win.isVisible()) win.hide()
}

/** True while the frame is on screen - used to keep it out of screenshots. */
export function isOverlayVisible(): boolean {
  return Boolean(win && !win.isDestroyed() && win.isVisible())
}

/** The approval card on screen, if any, and how to settle it. */
let pendingApproval: { id: number; resolve: (decision: ApprovalDecision) => void } | null = null
let nextApprovalId = 1

ipcMain.on('argus:approval-answer', (_event, id: number, decision: ApprovalDecision) => {
  if (pendingApproval?.id !== id) return
  if (decision?.kind === 'allow') settleApproval({ kind: 'allow' })
  else if (decision?.kind === 'change' && typeof decision.note === 'string' && decision.note.trim()) {
    settleApproval({ kind: 'change', note: decision.note.trim().slice(0, 2000) })
  } else settleApproval({ kind: 'stop' })
})

// Only for typing a change request. Given back the moment the card closes, so
// the agent's next keystrokes reach the app, not this window.
ipcMain.on('argus:overlay-focus', (_event, focused: boolean) => {
  if (!win || win.isDestroyed()) return
  if (focused && pendingApproval) {
    win.setFocusable(true)
    win.setIgnoreMouseEvents(false)
    win.focus()
  } else {
    releaseFocus()
  }
})

function releaseFocus(): void {
  if (!win || win.isDestroyed() || !win.isFocusable()) return
  win.blur()
  win.setFocusable(false)
}

// Clicks pass through the overlay to the desktop everywhere except over the
// card. `forward` keeps mouse-move events arriving while clicks pass through,
// which is how the card knows the pointer has come onto it.
ipcMain.on('argus:overlay-interactive', (_event, interactive: boolean) => {
  if (!win || win.isDestroyed()) return
  // Never while the agent's own input is in flight: its pointer passing over
  // the to-do pill on the way to a click must not turn that click into a
  // click on the pill. An approval card is the exception - the agent is
  // waiting on it, so nothing of its own can be in flight.
  const allow = interactive && (pendingApproval !== null || !agentIsActing())
  setOverlayInteractiveState(allow)
  if (allow) win.setIgnoreMouseEvents(false)
  else win.setIgnoreMouseEvents(true, { forward: true })
})

/**
 * Shows the run's to-do list in the banner - or clears it with null.
 */
export function updateTodos(items: TodoItem[] | null): void {
  if (overlayReady && win && !win.isDestroyed()) win.webContents.send('argus:todos', items)
}

function settleApproval(decision: ApprovalDecision): void {
  const pending = pendingApproval
  if (!pending) return
  pendingApproval = null
  if (win && !win.isDestroyed()) {
    win.webContents.send('argus:approval', null)
    releaseFocus()
    setOverlayInteractiveState(false)
    win.setIgnoreMouseEvents(true, { forward: true })
  }
  pending.resolve(decision)
}

/** True once the overlay can show an approval card. */
export function canAskInOverlay(): boolean {
  return overlayReady && Boolean(win && !win.isDestroyed())
}

/**
 * Shows an approval card under the banner and waits for an answer.
 *
 * The overlay is never focusable, so answering does not move keyboard focus
 * away from the app the agent is working in - a Ctrl+Enter approved in
 * Gmail still lands in Gmail. Resolves false if `signal` aborts, which is
 * what Escape does.
 */
export function requestApproval(
  request: Omit<ApprovalRequest, 'id'>,
  signal?: AbortSignal
): Promise<ApprovalDecision> {
  settleApproval({ kind: 'stop' })
  const overlay = ensureOverlay()
  showOverlay(overlayKind)

  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ kind: 'stop' })
    const id = nextApprovalId++
    const onAbort = (): void => settleApproval({ kind: 'stop' })
    signal?.addEventListener('abort', onAbort, { once: true })
    pendingApproval = {
      id,
      resolve: (decision) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(decision)
      }
    }
    overlay.setIgnoreMouseEvents(true, { forward: true })
    overlay.webContents.send('argus:approval', { ...request, id } satisfies ApprovalRequest)
  })
}
