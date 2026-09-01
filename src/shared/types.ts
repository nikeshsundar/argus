/** Which of the two product modes a request is asking for. */
export type Mode = 'talk' | 'agent'

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
