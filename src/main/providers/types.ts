import type { AgentAction } from '../../shared/agent'
import type { AgentRunRecord } from '../../shared/agentHistory'
import type { Turn } from '../../shared/types'
import type { ProviderName } from '../settingsStore'

export interface VisionRequest {
  /** What the user asked about their screen. */
  prompt: string
  /** PNG of the screen, already downscaled for the model. */
  image: Buffer
  /**
   * Earlier turns about this same screenshot, so follow-ups like "and what
   * about its subscriber count?" resolve against what was already discussed.
   */
  history: Turn[]
  /**
   * Which message carries the screenshot, indexed into
   * `[...history, thisPrompt]`. It is 0 for a fresh conversation, and
   * `history.length` when resuming a saved thread - whose stored turns are
   * text only, so the image belongs to the new question about the live screen.
   */
  imageAnchor: number
  /** Called with each chunk of the answer as it streams in. */
  onDelta: (text: string) => void
  signal?: AbortSignal
}

/**
 * Talk Mode: look at a screenshot, answer a question about it.
 * Every provider implements this.
 */
export interface VisionProvider {
  readonly name: ProviderName
  ask(request: VisionRequest): Promise<string>
}

/** One task's worth of agent conversation, held by the provider. */
export interface AgentSession {
  /**
   * Decides the next action from the current screen.
   * `lastResult` reports how the previous action went, so the model can adapt.
   */
  next(screenshot: Buffer, lastResult?: string): Promise<AgentAction>
}

/** Agent Mode: drive the machine, one action at a time. */
export interface ComputerUseProvider {
  readonly name: ProviderName
  /**
   * `installedApps` lets the model name programs it can launch directly, and
   * `history` is the last few tasks and how they went - without it a follow-up
   * like "open it in Edge instead" arrives with no idea what "it" was.
   */
  startTask(
    task: string,
    signal?: AbortSignal,
    installedApps?: string[],
    history?: AgentRunRecord[]
  ): AgentSession
}

/** Raised when a provider is selected but not usable yet (e.g. no API key). */
export class ProviderUnavailableError extends Error {}
