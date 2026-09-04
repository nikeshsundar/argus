import Anthropic from '@anthropic-ai/sdk'
import { TALK_SYSTEM_PROMPT } from './prompt'
import { ProviderUnavailableError, type VisionProvider, type VisionRequest } from './types'

export function createClaudeProvider(options: { apiKey: string; model: string }): VisionProvider {
  if (!options.apiKey) {
    throw new ProviderUnavailableError(
      'No Claude API key set. Type "/key sk-ant-..." here to add one.'
    )
  }

  const client = new Anthropic({ apiKey: options.apiKey })

  return {
    name: 'claude',

    async ask({
      prompt,
      image,
      history,
      imageAnchor,
      onDelta,
      signal
    }: VisionRequest): Promise<string> {
      // The screenshot rides on one turn only - later questions are about the
      // same screen, so re-sending it would just burn tokens.
      const imageBlock: Anthropic.Beta.BetaImageBlockParam = {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') }
      }

      const messages: Anthropic.Beta.BetaMessageParam[] = history.map((turn, index) => ({
        role: turn.role === 'model' ? 'assistant' : 'user',
        content:
          index === imageAnchor
            ? [imageBlock, { type: 'text', text: turn.text }]
            : [{ type: 'text', text: turn.text }]
      }))

      messages.push({
        role: 'user',
        content:
          history.length === imageAnchor
            ? [imageBlock, { type: 'text', text: prompt }]
            : [{ type: 'text', text: prompt }]
      })

      try {
        const stream = client.beta.messages.stream(
          {
            model: options.model,
            max_tokens: 4096,
            system: TALK_SYSTEM_PROMPT,
            // Screen questions are quick lookups - low effort keeps the bar responsive.
            output_config: { effort: 'low' },
            // A screenshot can trip a safety classifier; fall back rather than dead-end.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            messages
          },
          { signal }
        )

        stream.on('text', onDelta)
        const final = await stream.finalMessage()

        if (final.stop_reason === 'refusal') {
          throw new Error("Claude declined to answer about this screen's contents.")
        }

        return final.content
          .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('')
          .trim()
      } catch (error) {
        throw toFriendlyError(error)
      }
    }
  }
}

function toFriendlyError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new Error('That Claude API key was rejected. Set a new one with "/key sk-ant-...".')
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new Error('Rate limited by the Claude API - try again in a moment.')
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new Error('Could not reach the Claude API. Check your connection.')
  }
  if (error instanceof Anthropic.APIError) {
    return new Error(`Claude API error ${error.status ?? ''}: ${error.message}`.trim())
  }
  return error instanceof Error ? error : new Error(String(error))
}
