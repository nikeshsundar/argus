import { describe, expect, it } from 'vitest'
import { advanceHint, parseTeachRequest } from '../src/shared/teach'

describe('parseTeachRequest', () => {
  it('recognises the ways people ask to be taught', () => {
    for (const text of [
      'teach me how to create a new repo in github',
      'teachme how to create a new repo in github',
      'show me how to create a new repo in github',
      'walk me through creating a new repo in github',
      'guide me through creating a new repo in github'
    ]) {
      expect(parseTeachRequest(text).teach, text).toBe(true)
    }
  })

  it('strips the trigger and its connective, leaving a goal', () => {
    // "teach me how to create a repo" is a question about teaching; "create a
    // repo" is the thing to point at. Only the second is useful to the model.
    expect(parseTeachRequest('teach me how to create a new repo')).toEqual({
      teach: true,
      topic: 'create a new repo'
    })
    expect(parseTeachRequest('teach me to change my wallpaper')).toEqual({
      teach: true,
      topic: 'change my wallpaper'
    })
    expect(parseTeachRequest('teach me about pivot tables')).toEqual({
      teach: true,
      topic: 'pivot tables'
    })
    expect(parseTeachRequest('teach me how do i split my screen')).toEqual({
      teach: true,
      topic: 'split my screen'
    })
  })

  it('tolerates punctuation and casing after the trigger', () => {
    expect(parseTeachRequest('Teach me: how to zip a folder').topic).toBe('zip a folder')
    expect(parseTeachRequest('TEACH ME how to zip a folder').topic).toBe('zip a folder')
  })

  it('leaves ordinary requests alone', () => {
    for (const text of [
      'open instagram',
      'what is on my screen',
      'summarise this page',
      'teacher salary in india'
    ]) {
      const parsed = parseTeachRequest(text)
      expect(parsed.teach, text).toBe(false)
      expect(parsed.topic, text).toBe(text)
    }
  })

  it('does not fire on a word that merely starts with the trigger', () => {
    // "teachme" is deliberate shorthand; "teaches" is not a request.
    expect(parseTeachRequest('teaches me nothing').teach).toBe(false)
  })

  it('survives a trigger with nothing after it', () => {
    expect(parseTeachRequest('teach me')).toEqual({ teach: true, topic: '' })
  })
})

describe('advanceHint', () => {
  it('tells the learner how to move on, per kind of step', () => {
    expect(advanceHint('click')).toMatch(/click it/i)
    expect(advanceHint('type')).toMatch(/type it/i)
    expect(advanceHint('look')).toMatch(/space/i)
  })

  it('always names a keyboard way out, so a missed click cannot trap them', () => {
    for (const action of ['click', 'type', 'look'] as const) {
      expect(advanceHint(action), action).toMatch(/space/i)
    }
  })
})
