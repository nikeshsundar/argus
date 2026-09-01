import { describe, expect, it } from 'vitest'
import { inferProviderFromKey } from '../src/shared/keys'

describe('inferProviderFromKey', () => {
  it('recognises Anthropic keys', () => {
    expect(inferProviderFromKey('sk-ant-api03-abc123')).toBe('claude')
  })

  it.each(['AIzaSyAbc123', 'AQ.Ab8RN6abc123'])('recognises the Google key format %j', (key) => {
    expect(inferProviderFromKey(key)).toBe('gemini')
  })

  it('treats a bare sk- key as OpenAI', () => {
    expect(inferProviderFromKey('sk-proj-abc123')).toBe('openai')
  })

  it('prefers Anthropic over OpenAI for sk-ant- keys', () => {
    // Both patterns start with "sk-" - order matters.
    expect(inferProviderFromKey('sk-ant-xyz')).not.toBe('openai')
  })

  it('returns null for an unrecognised format', () => {
    expect(inferProviderFromKey('hunter2')).toBeNull()
  })
})
