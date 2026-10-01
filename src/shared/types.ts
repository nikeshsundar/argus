import { parseTeachRequest } from './teach'

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
  /** How far through the task's to-do list the agent is, when it has one. */
  todo?: { done: number; total: number }
}

/** One item of an agent run's to-do list, as the overlay shows it. */
export interface TodoItem {
  text: string
  state: 'done' | 'active' | 'pending'
}

/** A step waiting for the user's OK, shown as a card under the overlay banner. */
export interface ApprovalRequest {
  id: number
  /** What will happen, in the user's terms: "Click Send". */
  title: string
  task: string
  /** The exact action, for anyone who wants to check the detail. */
  step: string
  /** The text about to be typed or sent, when there is any. */
  text?: string
  /** Whether "Change" is offered - only when a model is there to act on it. */
  canChange: boolean
}

/** What the user chose on an approval card. */
export type ApprovalDecision =
  | { kind: 'allow' }
  | { kind: 'stop' }
  | { kind: 'change'; note: string }

/**
 * The agent's pointer, in CSS pixels relative to the overlay's display.
 * `click` additionally asks the overlay to fire a one-shot ring.
 */
export interface AgentCursorEvent {
  x: number
  y: number
  phase: 'move' | 'click' | 'scroll' | 'type'
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
  'show', 'help'
])

/**
 * Verbs that make something - and whether the result belongs in the bar or on
 * the machine depends on what is being made, so these are judged by their object.
 *
 * They used to sit in TALK_VERBS outright, which sent "create a new repository"
 * and "make a folder on the desktop" to a chat answer instead of the agent:
 * the chip flipped to Talk the moment the first word was typed.
 */
const MAKER_VERBS = new Set(['write', 'draft', 'compose', 'create', 'make', 'generate'])

/** What a maker verb produces when the answer is text to read in the bar. */
const CONTENT_NOUNS =
  /\b(?:poems?|story|stories|jokes?|essays?|summary|summaries|lists?|ideas?|outlines?|captions?|bios?|taglines?|slogans?|haikus?|songs?|lyrics|quotes?|titles?|headlines?|names?|paragraphs?|descriptions?|explanations?|answers?|questions?|passwords?|bullet points?)\b/i

/** Somewhere on the machine or the web - what is made has to land there. */
const DESTINATION =
  /\b(?:in|on|into|inside|onto)\s+(?:(?:the|a|an|my|new|this)\s+)*(?:notepad|word|docs?|google\s+docs?|sheets?|google\s+sheets?|excel|powerpoint|slides|gmail|outlook|github|slack|whatsapp|teams|discord|chrome|edge|browser|desktop|folder|file|calendar|drive|notion|canva|vs\s*code|terminal|document|spreadsheet)\b/i

/**
 * Openers that make a sentence a question even without a question mark.
 *
 * This list and TALK_VERBS are now the whole of the Talk side: acting is the
 * default, so these are what a request has to look like to be answered instead
 * of performed. Anything worth adding belongs here rather than in a list of
 * action verbs, which no longer exists - it could only ever repeat the default.
 */
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
 * Acting is the default, so everything unrecognised falls through to Agent.
 * Every signal that a request is a question is still checked first and still
 * wins - a question mark, an opening question word, a verb aimed at the model
 * rather than the machine. What reaches the fallback is genuinely ambiguous,
 * and this app is for doing things.
 *
 * That trade is not free: a fragment the classifier cannot place now reaches
 * for the mouse instead of answering. Three things make it survivable - the
 * chip names the mode before Enter is pressed, the overlay is impossible to
 * miss once it starts, and Escape stops it from anywhere.
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
  const agent = { mode: 'agent', prompt } as const

  // "teach me how to ..." means the walkthrough on the real screen - Teach
  // Mode, which runs from Agent. It used to land in Talk because "teach" and
  // "show" were talk verbs, so typing it gave written steps unless the chip
  // was flipped by hand. Talk is still one click (or "ask teach me ...") away.
  if (parseTeachRequest(prompt).teach) return agent

  if (prompt.endsWith('?')) return talk

  const opener = firstWord(prompt)
  if (TALK_VERBS.has(opener) || QUESTION_WORDS.has(opener)) return talk

  if (MAKER_VERBS.has(opener)) {
    // "write a poem in notepad" names a place, so the work happens there.
    if (DESTINATION.test(prompt)) return agent
    // "write a poem", "generate 5 title ideas": text to read, answered here.
    if (CONTENT_NOUNS.test(prompt)) return talk
    // "create a repo", "make a folder": something made on the machine.
    return agent
  }

  return agent
}
