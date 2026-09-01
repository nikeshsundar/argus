import Anthropic from '@anthropic-ai/sdk'
import { ProviderUnavailableError, type VisionProvider, type VisionRequest } from './types'

const SYSTEM_PROMPT = `You are Argus, an assistant that looks at the user's screen and answers questions about what is on it.

You receive a screenshot of the user's active display together with their question.

- Answer in 1-3 short sentences. Your answer renders in a small overlay bar, not a chat window.
- Be concrete: name the actual button, menu, file, or error text you can see on screen.
- If the answer is a sequence of actions, give at most three, one per line, numbered.
- If the screenshot doesn't show what you'd need to answer, say that in one sentence.
- Don't describe the whole screen unless you're asked to.`

export function createClaudeProvider(options: { apiKey: string; model: string }): VisionProvider {
  if (!options.apiKey) {
    throw new ProviderUnavailableError(
      'No Claude API key set. Type "/key sk-ant-..." here to add one.'
    )
  }

  const client = new Anthropic({ apiKey: options.apiKey })

  return {
    name: 'claude',

    async ask({ prompt, image, onDelta, signal }: VisionRequest): Promise<string> {
      try {
        const stream = client.beta.messages.stream(
          {
            model: options.model,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            // Screen questions are quick lookups - low effort keeps the bar responsive.
            output_config: { effort: 'low' },
            // A screenshot can trip a safety classifier; fall back rather than dead-end.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: image.toString('base64')
                    }
                  },
                  { type: 'text', text: prompt }
                ]
              }
            ]
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
