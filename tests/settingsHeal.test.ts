import { describe, expect, it } from 'vitest'
import { inferProviderFromKey } from '../src/shared/keys'

/**
 * Fixtures are invented, never copied from a real settings file.
 *
 * Every one carries EXAMPLE in its body, which is what `noRealKeys` below
 * greps for: a key-shaped string anywhere in this repo that does not say
 * EXAMPLE is assumed to be somebody's actual credential.
 */
const FAKE = {
  geminiStudio: 'AIzaSyEXAMPLE000000000000000000000000000',
  geminiNewer: 'AQ.EXAMPLE00000000000000000000000000000000000000000',
  claude: 'sk-ant-api03-EXAMPLE000000000000000000',
  openai: 'sk-proj-EXAMPLE00000000000000000000000'
}

/**
 * The guard behind the settings self-repair. A model name that the key
 * detector recognises is a key that was typed into /model by mistake.
 */
describe('inferProviderFromKey as a model-name guard', () => {
  it('flags the key formats that have been mistaken for model names', () => {
    expect(inferProviderFromKey(FAKE.geminiStudio)).toBe('gemini')
    expect(inferProviderFromKey(FAKE.geminiNewer)).toBe('gemini')
    expect(inferProviderFromKey(FAKE.claude)).toBe('claude')
    expect(inferProviderFromKey(FAKE.openai)).toBe('openai')
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
