import { describe, expect, it } from 'vitest'
import { inferProviderFromKey } from '../src/shared/keys'

/**
 * The guard behind the settings self-repair. A model name that the key
 * detector recognises is a key that was typed into /model by mistake.
 */
describe('inferProviderFromKey as a model-name guard', () => {
  it('flags the key formats that have been mistaken for model names', () => {
    expect(inferProviderFromKey('AIzaSyEXAMPLE000000000000000000000000000')).toBe('gemini')
    expect(inferProviderFromKey('AQ.EXAMPLE00000000000000000000')).toBe('gemini')
    expect(inferProviderFromKey('sk-ant-api03-abc123')).toBe('claude')
    expect(inferProviderFromKey('sk-proj-abc123')).toBe('openai')
  })

  it('leaves real model names alone, including the shipped defaults', () => {
    for (const model of [
      'gemini-3.6-flash',
      'gemini-2.5-pro',
      'claude-opus-5',
      'claude-sonnet-5',
      'llama3.2-vision'
    ]) {
      expect(inferProviderFromKey(model)).toBeNull()
    }
  })
})
