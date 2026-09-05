import { describe, expect, it } from 'vitest'
import { parseMode } from '../src/shared/types'

const mode = (text: string): string => parseMode(text).mode

describe('inferring Agent Mode without the trigger word', () => {
  it('acts on a bare instruction', () => {
    // The case that started this: "open instagram" described what to do
    // instead of doing it, because it did not begin with "agent".
    expect(parseMode('open instagram')).toEqual({ mode: 'agent', prompt: 'open instagram' })
  })

  it('acts on the usual desktop verbs', () => {
    for (const text of [
      'open chrome and go to github',
      'close all my tabs',
      'play the next song',
      'search for flights to tokyo',
      'download that file',
      'send a message to mum',
      'turn on dark mode',
      'minimise this window',
      'install vs code'
    ]) {
      expect(mode(text), text).toBe('agent')
    }
  })

  it('sees through politeness, including stacked politeness', () => {
    expect(parseMode('please open instagram')).toEqual({
      mode: 'agent',
      prompt: 'open instagram'
    })
    expect(parseMode('can you open instagram')).toEqual({
      mode: 'agent',
      prompt: 'open instagram'
    })
    expect(parseMode('hey, can you open instagram')).toEqual({
      mode: 'agent',
      prompt: 'open instagram'
    })
    expect(parseMode('i want you to open instagram')).toEqual({
      mode: 'agent',
      prompt: 'open instagram'
    })
  })
})

describe('questions stay in Talk Mode', () => {
  it('keeps anything ending in a question mark', () => {
    // "open" is an action verb, but this is plainly a question about it.
    expect(mode('open instagram?')).toBe('talk')
    expect(mode('can I open this file?')).toBe('talk')
  })

  it('keeps sentences that open with a question word', () => {
    for (const text of [
      'what is on my screen',
      "what's this error",
      'why did this fail',
      'how do I fix this',
      'is this safe to click',
      'which tab has instagram open'
    ]) {
      expect(mode(text), text).toBe('talk')
    }
  })

  it('keeps verbs that instruct the model rather than the machine', () => {
    // These read as commands, but the thing being commanded is the model.
    for (const text of [
      'summarise this page',
      'explain this error',
      'describe what you see',
      'translate this to tamil',
      'read the text in this image',
      'write a poem about cats',
      'show me what changed'
    ]) {
      expect(mode(text), text).toBe('talk')
    }
  })

  it('falls back to Agent for anything it does not recognise', () => {
    // Acting is the default: everything that looks like a question has already
    // been checked by the time a request reaches the fallback.
    for (const text of ['instagram', 'the thing in the corner', 'my downloads folder']) {
      expect(mode(text), text).toBe('agent')
    }
  })

  it('still acts on desktop verbs no list ever enumerated', () => {
    // The point of defaulting to Agent: these never needed to be listed.
    for (const text of ['defragment the disk', 'unzip that archive', 'star this repo']) {
      expect(mode(text), text).toBe('agent')
    }
  })
})

describe('explicit prefixes still win', () => {
  it('forces Agent even when the wording is a question', () => {
    expect(parseMode('agent what is on my screen')).toEqual({
      mode: 'agent',
      prompt: 'what is on my screen'
    })
  })

  it('forces Talk even when the wording is an order', () => {
    expect(parseMode('ask open instagram')).toEqual({ mode: 'talk', prompt: 'open instagram' })
    expect(parseMode('talk close this tab')).toEqual({ mode: 'talk', prompt: 'close this tab' })
  })

  it('does not mistake a word that merely starts with the trigger', () => {
    // The mode no longer proves this either way - unrecognised wording is
    // Agent regardless. What matters is that the word survives into the
    // prompt: a stripped "agentic" would send "ic workflows explained".
    expect(parseMode('agentic workflows explained').prompt).toBe('agentic workflows explained')
    expect(parseMode('asking about my screen').prompt).toBe('asking about my screen')
  })
})
