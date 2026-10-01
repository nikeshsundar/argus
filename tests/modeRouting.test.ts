import { describe, expect, it } from 'vitest'
import { parseMode } from '../src/shared/types'

const mode = (text: string): string => parseMode(text).mode

describe('making something on the machine goes to the agent', () => {
  it('no longer flips "create" to Talk', () => {
    // The reported bug: the chip switched to Talk as "create" was typed.
    for (const text of [
      'create',
      'create a new repository',
      'create a repo on github called demo',
      'can you create a new google doc',
      'make a folder on the desktop',
      'make a chart from this table',
      'write hello world in notepad',
      'write the top 10 Indian companies and their revenue in google sheets',
      'draft an email to my manager asking for leave'
    ]) {
      expect(mode(text), text).toBe('agent')
    }
  })

  it('still answers in the bar when what is made is text to read', () => {
    for (const text of [
      'write a poem about cats',
      'generate 5 title ideas for my video',
      'make a list of the files on screen',
      'write a summary of this page',
      'create a short bio for me',
      'generate a strong password'
    ]) {
      expect(mode(text), text).toBe('talk')
    }
  })
})

describe('teach requests start the on-screen walkthrough', () => {
  it('routes "teach me how" and friends to Agent, where Teach Mode runs', () => {
    // These used to land in Talk and give written steps unless the chip was
    // flipped by hand - so the walkthrough never ran from a typed request.
    for (const text of [
      'teach me how to create a new repository',
      'teach me how to bookmark this page',
      'show me how to make a chart from this table',
      'walk me through setting up git',
      'teach me how to make a chart?'
    ]) {
      expect(mode(text), text).toBe('agent')
    }
  })

  it('keeps written steps one prefix away, and leaves "show me what" alone', () => {
    expect(mode('ask teach me how to zip a folder')).toBe('talk')
    expect(mode('show me what changed')).toBe('talk')
    expect(mode('how do I create a repo')).toBe('talk')
  })
})

describe('the demo script routes the way it reads', () => {
  it.each([
    ['open notepad and type Hello judges, this was typed by Argus', 'agent'],
    ['open calculator and calculate 125 times 8', 'agent'],
    ['open google sheets and write the top 10 Indian companies and their revenue', 'agent'],
    ["explain what's on my screen in 3 short points", 'talk']
  ])('%s → %s', (text, expected) => {
    expect(mode(text)).toBe(expected)
  })
})
