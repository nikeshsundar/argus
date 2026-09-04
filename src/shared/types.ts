/** Which of the two product modes a request is asking for. */
export type Mode = 'talk' | 'agent'

/** Vision backends Talk Mode can run on. Agent Mode drives the desktop on Gemini. */
export type ProviderName = 'claude' | 'gemini' | 'openai' | 'ollama'

/** Metadata about a screen capture. The image itself never leaves the main process. */
export interface CaptureInfo {
  width: number
  height: number
  displayId: number
  capturedAt: number
}

/**
 * Whether the rolling screen recording is running, and for how long back.
 *
 * Sent with every open so the bar can show it. A feature that remembers your
 * screen has to say so somewhere you cannot miss - a setting buried in a file
 * is not consent, it is a thing you agreed to once and forgot.
 */
export interface MemoryIndicator {
  recording: boolean
  /** Short form for the pill, e.g. "10m". */
  label: string
}

/** Sent to the renderer each time the request bar is opened by the hotkey. */
export interface OpenedEvent {
  capture: CaptureInfo | null
  error?: string
  /** Replaces the default status line - used for first-run setup hints. */
  notice?: string
  memory?: MemoryIndicator
}

/** One exchange in an ongoing Talk Mode conversation. */
export interface Turn {
  role: 'user' | 'model'
  text: string
}

/** A saved conversation. Text only - screenshots are never written to disk. */
export interface Thread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  turns: Turn[]
}

/** A thread as shown in the history list. */
export interface ThreadSummary {
  id: string
  title: string
  updatedAt: number
  questions: number
}

/** Progress report sent to the overlay while Agent Mode is running. */
export interface AgentStepEvent {
  description: string
  index: number
  max: number
}

/**
 * The agent's pointer, in CSS pixels relative to the overlay's display.
 * `click` additionally asks the overlay to fire a one-shot ring.
 */
export interface AgentCursorEvent {
  x: number
  y: number
  phase: 'move' | 'click'
}

/** Which face the overlay wears: driving the machine, or pointing at it. */
export type OverlayKind = 'agent' | 'teach'

/**
 * Where to draw the ghost cursor, in CSS pixels relative to the overlay's
 * display. Null takes it off screen.
 */
export interface TeachStepEvent {
  step: import('./teach').TeachStep
  x: number
  y: number
}

/** Result of submitting a request from the bar. */
export interface SubmitResult {
  ok: boolean
  mode: Mode
  message: string
}

/** Forces Agent Mode, whatever the wording after it. */
const AGENT_PREFIX = /^\s*agent\b[,:]?\s*/i

/** Forces Talk Mode - the escape hatch when a question reads like an order. */
const TALK_PREFIX = /^\s*(?:ask|talk)\b[,:]?\s*/i

/**
 * Politeness wrapped around a real instruction. Stripped before intent is
 * judged, so "can you open instagram" is read as "open instagram" rather than
 * as a question beginning with "can".
 */
const PLEASANTRIES =
  /^\s*(?:hey|hi|yo|ok(?:ay)?|please|pls|plz|now|just|(?:can|could|would|will) you|i (?:want|need) you to|go ahead and)\b[,:]?\s*/i

/**
 * Verbs that ask about the screen rather than act on it.
 *
 * Checked before the action verbs because several read as commands too -
 * "summarise this page" is an instruction, but the thing being instructed is
 * the model, not the machine.
 */
const TALK_VERBS = new Set([
  'summarise', 'summarize', 'explain', 'describe', 'translate', 'define',
  'analyse', 'analyze', 'compare', 'identify', 'read', 'transcribe', 'tell',
  'list', 'name', 'rate', 'review', 'critique', 'suggest', 'recommend',
  'teach', 'show', 'write', 'draft', 'compose', 'create', 'make', 'generate',
  'help'
])

/**
 * Verbs that only make sense as something done to the computer.
 *
 * Deliberately narrow. Anything ambiguous is left out: the cost of missing one
 * is a description the user has to redo with "agent", while the cost of a false
 * positive is the machine grabbing the mouse when nobody asked it to.
 */
const ACTION_VERBS = new Set([
  'open', 'launch', 'start', 'run', 'execute', 'close', 'quit', 'exit', 'kill',
  'minimise', 'minimize', 'maximise', 'maximize', 'restore', 'resize', 'move',
  'snap', 'pin', 'unpin', 'focus', 'click', 'doubleclick', 'rightclick',
  'press', 'tap', 'type', 'scroll', 'drag', 'select', 'highlight',
  'search', 'google', 'browse', 'navigate', 'visit', 'goto', 'go',
  'play', 'pause', 'resume', 'stop', 'skip', 'mute', 'unmute',
  'download', 'install', 'uninstall', 'copy', 'paste', 'cut', 'rename',
  'delete', 'send', 'post', 'tweet', 'message', 'email', 'reply', 'forward',
  'share', 'upload', 'attach', 'submit', 'sign', 'login', 'logout', 'signin',
  'signout', 'turn', 'enable', 'disable', 'toggle', 'switch', 'refresh',
  'reload', 'bookmark', 'print', 'screenshot', 'capture', 'lock', 'unlock',
  'restart', 'shutdown', 'connect', 'disconnect', 'join', 'leave', 'zoom',
  'buy', 'order', 'book', 'checkout', 'clear', 'empty', 'set'
])

/** Openers that make a sentence a question even without a question mark. */
const QUESTION_WORDS = new Set([
  'what', "what's", 'whats', 'why', 'how', 'who', "who's", 'whos', 'when',
  'where', "where's", 'wheres', 'which', 'whose', 'is', 'are', 'was', 'were',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'am', 'has',
  'have', 'any', 'anything'
])

/** The first word, lowercased and stripped of punctuation. */
function firstWord(text: string): string {
  return (/^[a-z']+/i.exec(text.trim())?.[0] ?? '').toLowerCase()
}

/**
 * Decides whether a request is a question about the screen or an instruction to
 * act on the machine.
 *
 * "agent ..." still forces Agent Mode and "ask ..." forces Talk, but neither is
 * required: an imperative like "open instagram" is routed to the agent on its
 * own, because having to remember a magic word to make the thing act is the
 * kind of friction that stops people using it at all.
 *
 * Everything unrecognised falls through to Talk. Answering a question that was
 * meant as a command wastes a turn; taking control of a machine that only asked
 * a question is a much worse way to be wrong.
 */
export function parseMode(text: string): { mode: Mode; prompt: string } {
  const forcedAgent = AGENT_PREFIX.exec(text)
  if (forcedAgent) return { mode: 'agent', prompt: text.slice(forcedAgent[0].length).trim() }

  const forcedTalk = TALK_PREFIX.exec(text)
  if (forcedTalk) return { mode: 'talk', prompt: text.slice(forcedTalk[0].length).trim() }

  // Politeness can stack: "hey, can you open instagram".
  let prompt = text.trim()
  for (;;) {
    const polite = PLEASANTRIES.exec(prompt)
    if (!polite || polite[0].length === 0) break
    prompt = prompt.slice(polite[0].length).trim()
  }

  const talk = { mode: 'talk', prompt } as const
  if (prompt.endsWith('?')) return talk

  const opener = firstWord(prompt)
  if (TALK_VERBS.has(opener) || QUESTION_WORDS.has(opener)) return talk
  if (ACTION_VERBS.has(opener)) return { mode: 'agent', prompt }

  return talk
}
