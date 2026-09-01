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

/** Raised when a provider is selected but not usable yet (e.g. no API key). */
export class ProviderUnavailableError extends Error {}
