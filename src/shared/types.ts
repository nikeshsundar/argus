/** Which of the two product modes a request is asking for. */
export type Mode = 'talk' | 'agent'

/** Vision backends Talk Mode can run on. Agent Mode is Claude-only. */
export type ProviderName = 'claude' | 'gemini' | 'openai' | 'ollama'

/** Metadata about a screen capture. The image itself never leaves the main process. */
export interface CaptureInfo {
  width: number
  height: number
  displayId: number
  capturedAt: number
}

/** Sent to the renderer each time the request bar is opened by the hotkey. */
export interface OpenedEvent {
  capture: CaptureInfo | null
  error?: string
  /** Replaces the default status line - used for first-run setup hints. */
  notice?: string
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

/** Result of submitting a request from the bar. */
export interface SubmitResult {
  ok: boolean
  mode: Mode
  message: string
}

/**
 * A request is treated as Agent Mode when it starts with "agent" (optionally
 * followed by a comma) - mirroring HeyClicky's "heyclicky agent" trigger.
 * Everything else is Talk Mode.
 */
export function parseMode(text: string): { mode: Mode; prompt: string } {
  const match = /^\s*agent\b[,:]?\s*/i.exec(text)
  if (match) {
    return { mode: 'agent', prompt: text.slice(match[0].length).trim() }
  }
  return { mode: 'talk', prompt: text.trim() }
}
