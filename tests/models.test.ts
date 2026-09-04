import { describe, expect, it } from 'vitest'
import {
  CATALOGUE,
  DEFAULT_MODEL_ID,
  defaultChoice,
  keySource,
  needsKey,
  parseAiModelCommand,
  providerDefault,
  providers,
  renderCatalogue,
  resolveChoice,
  suggestModels
} from '../src/shared/models'

describe('the catalogue', () => {
  it('defaults to the one that needs no card', () => {
    // Anything else as the default puts a paywall between someone cloning the
    // repo and Argus doing anything at all.
    expect(defaultChoice().id).toBe(DEFAULT_MODEL_ID)
    expect(defaultChoice().provider).toBe('gemini')
    expect(defaultChoice().note).toContain('free')
  })

  it('leads with the free option', () => {
    expect(CATALOGUE[0]?.provider).toBe('gemini')
  })

  it('gives every entry an id, a label and a reason to pick it', () => {
    for (const choice of CATALOGUE) {
      expect(choice.id, choice.label).toBeTruthy()
      expect(choice.label, choice.id).toBeTruthy()
      expect(choice.note, choice.id).toBeTruthy()
    }
  })

  it('has no duplicate ids, which would make a number mean two things', () => {
    const ids = CATALOGUE.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('can name a key source for every provider it lists', () => {
    for (const provider of providers()) {
      expect(keySource(provider), provider).toBeTruthy()
    }
  })

  it('knows Ollama is the one that needs no key', () => {
    expect(needsKey('ollama')).toBe(false)
    expect(needsKey('gemini')).toBe(true)
  })

  it('picks a sensible model for a bare provider name', () => {
    expect(providerDefault('gemini')?.id).toBe(DEFAULT_MODEL_ID)
    expect(providerDefault('claude')?.provider).toBe('claude')
  })
})

describe('resolveChoice', () => {
  it('takes the row number people can see', () => {
    expect(resolveChoice('1')?.id).toBe(CATALOGUE[0]!.id)
    expect(resolveChoice('3')?.id).toBe(CATALOGUE[2]!.id)
  })

  it('refuses a row number that is not on the list', () => {
    expect(resolveChoice('0')).toBeNull()
    expect(resolveChoice('999')).toBeNull()
  })

  it('takes an exact model id', () => {
    expect(resolveChoice('claude-opus-5')?.label).toBe('Claude Opus')
  })

  it('takes a bare provider name and means its default', () => {
    expect(resolveChoice('gemini')?.id).toBe(DEFAULT_MODEL_ID)
    expect(resolveChoice('openai')?.provider).toBe('openai')
  })

  it('takes a provider plus a model, the way people say it out loud', () => {
    expect(resolveChoice('claude sonnet')?.id).toBe('claude-sonnet-5')
    expect(resolveChoice('claude opus')?.id).toBe('claude-opus-5')
  })

  it('takes an unambiguous fragment on its own', () => {
    expect(resolveChoice('sonnet')?.id).toBe('claude-sonnet-5')
    expect(resolveChoice('haiku')?.id).toBe('claude-haiku-4-5-20251001')
  })

  it('refuses an ambiguous fragment rather than guessing', () => {
    // "flash" is two Gemini models and "gpt" is two OpenAI ones. Guessing here
    // bills someone for a model they did not choose.
    expect(resolveChoice('flash')).toBeNull()
    expect(resolveChoice('gpt')).toBeNull()
  })

  it('ignores case and stray spacing', () => {
    expect(resolveChoice('  CLAUDE   Sonnet ')?.id).toBe('claude-sonnet-5')
  })

  it('finds nothing for an empty query', () => {
    expect(resolveChoice('   ')).toBeNull()
  })
})

describe('suggestModels', () => {
  it('offers what was nearly typed', () => {
    expect(suggestModels('gpt')).toEqual(['gpt-5', 'gpt-5-mini'])
  })

  it('offers everything when nothing was typed', () => {
    expect(suggestModels('')).toHaveLength(CATALOGUE.length)
  })
})

describe('parseAiModelCommand', () => {
  it('reads a bare command as asking for the menu', () => {
    expect(parseAiModelCommand('/aimodel')).toEqual({ kind: 'list' })
    expect(parseAiModelCommand('/ai')).toEqual({ kind: 'list' })
  })

  it('reads a choice', () => {
    expect(parseAiModelCommand('/aimodel 3')).toEqual({ kind: 'pick', query: '3' })
    expect(parseAiModelCommand('/aimodel claude sonnet')).toEqual({
      kind: 'pick',
      query: 'claude sonnet'
    })
  })

  it('accepts the separators people type', () => {
    expect(parseAiModelCommand('/aimodel: gemini')).toEqual({ kind: 'pick', query: 'gemini' })
    expect(parseAiModelCommand('/ai=gpt-5')).toEqual({ kind: 'pick', query: 'gpt-5' })
  })

  it('never swallows "/model", which is a different command', () => {
    // "/model <id>" sets a raw id and has to keep working on its own; a loose
    // pattern here would eat it and change the meaning of both.
    expect(parseAiModelCommand('/model gemini-3.6-flash')).toEqual({ kind: 'none' })
    expect(parseAiModelCommand('/model agent x')).toEqual({ kind: 'none' })
  })

  it('ignores anything that is not its command', () => {
    for (const text of ['/keys', '/aim', 'what model is this', '']) {
      expect(parseAiModelCommand(text), text).toEqual({ kind: 'none' })
    }
  })
})

describe('renderCatalogue', () => {
  const render = (activeId: string, keyed: string[] = []): string =>
    renderCatalogue({ activeId, hasKey: (provider) => keyed.includes(provider) })

  it('marks the one in use', () => {
    const text = render('claude-opus-5', ['claude'])
    const line = text.split('\n').find((one) => one.includes('Claude Opus'))
    expect(line).toContain('>')
    expect(line).toContain('in use')
  })

  it('says which rows cannot answer yet, before they are picked', () => {
    // Finding out a provider has no key costs a request and a confusing error;
    // saying so on the menu costs nothing.
    const text = render(DEFAULT_MODEL_ID, ['gemini'])
    expect(text.split('\n').find((one) => one.includes('GPT-5 '))).toContain('needs a key')
  })

  it('treats the local one as ready with no key at all', () => {
    const text = render(DEFAULT_MODEL_ID, [])
    expect(text.split('\n').find((one) => one.includes('Ollama'))).toContain('ready')
  })

  it('tells you where to get the keys you are missing', () => {
    expect(render(DEFAULT_MODEL_ID, ['gemini'])).toContain('console.anthropic.com')
  })

  it('drops the key section once nothing is missing', () => {
    const text = render(DEFAULT_MODEL_ID, ['gemini', 'claude', 'openai'])
    expect(text).not.toContain('Add a key')
  })

  it('always says the escape hatch is there', () => {
    expect(render(DEFAULT_MODEL_ID, [])).toContain('/model <id>')
  })
})
