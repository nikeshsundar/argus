import type { AgentAction } from '../../shared/agent'
import type { ProviderName } from '../settingsStore'

export interface VisionRequest {
  /** What the user asked about their screen. */
  prompt: string
  /** PNG of the screen, already downscaled for the model. */
  image: Buffer
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
  startTask(task: string, signal?: AbortSignal): AgentSession
}

/** Raised when a provider is selected but not usable yet (e.g. no API key). */
export class ProviderUnavailableError extends Error {}
