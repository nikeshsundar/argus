import { describe, expect, it } from 'vitest'
import {
  TUTORIAL,
  clampPage,
  isLastPage,
  parseTutorialCommand,
  tutorialFooter
} from '../src/shared/tutorial'

describe('parseTutorialCommand', () => {
  it('ignores anything that is not the command', () => {
    for (const text of ['/help', 'tutorial', '/tutorials', 'open the tutorial']) {
      expect(parseTutorialCommand(text), text).toEqual({ kind: 'none' })
    }
  })

  it('starts on the bare command, whatever the casing or padding', () => {
    for (const text of ['/tutorial', '  /TUTORIAL  ', '/Tutorial']) {
      expect(parseTutorialCommand(text), text).toEqual({ kind: 'start' })
    }
  })

  it('reads the navigation words and their short forms', () => {
    expect(parseTutorialCommand('/tutorial next')).toEqual({ kind: 'next' })
    expect(parseTutorialCommand('/tutorial n')).toEqual({ kind: 'next' })
    expect(parseTutorialCommand('/tutorial back')).toEqual({ kind: 'back' })
    expect(parseTutorialCommand('/tutorial prev')).toEqual({ kind: 'back' })
    expect(parseTutorialCommand('/tutorial exit')).toEqual({ kind: 'exit' })
    expect(parseTutorialCommand('/tutorial quit')).toEqual({ kind: 'exit' })
  })

  it('jumps to a page, counting from one', () => {
    expect(parseTutorialCommand('/tutorial 1')).toEqual({ kind: 'jump', index: 0 })
    expect(parseTutorialCommand('/tutorial 3')).toEqual({ kind: 'jump', index: 2 })
  })

  it('clamps a page number rather than failing on it', () => {
    // "/tutorial 99" should land somewhere, not error at someone who has not
    // started the tutorial yet.
    expect(parseTutorialCommand('/tutorial 99')).toEqual({
      kind: 'jump',
      index: TUTORIAL.length - 1
    })
    expect(parseTutorialCommand('/tutorial 0')).toEqual({ kind: 'jump', index: 0 })
  })

  it('treats an unrecognised argument as a plain start', () => {
    expect(parseTutorialCommand('/tutorial nxt')).toEqual({ kind: 'start' })
    expect(parseTutorialCommand('/tutorial please')).toEqual({ kind: 'start' })
  })
})

describe('page bounds', () => {
  it('keeps every index inside the tutorial', () => {
    expect(clampPage(-5)).toBe(0)
    expect(clampPage(0)).toBe(0)
    expect(clampPage(TUTORIAL.length + 10)).toBe(TUTORIAL.length - 1)
    expect(clampPage(Number.NaN)).toBe(0)
  })

  it('knows where the tour ends', () => {
    expect(isLastPage(0)).toBe(false)
    expect(isLastPage(TUTORIAL.length - 1)).toBe(true)
    expect(isLastPage(TUTORIAL.length + 4)).toBe(true)
  })
})

describe('the footer under each page', () => {
  it('counts from one, for a human', () => {
    expect(tutorialFooter(0)).toContain(`1 of ${TUTORIAL.length}`)
    expect(tutorialFooter(TUTORIAL.length - 1)).toContain(
      `${TUTORIAL.length} of ${TUTORIAL.length}`
    )
  })

  it('stops offering a next page on the last one', () => {
    expect(tutorialFooter(0)).toContain('next page')
    expect(tutorialFooter(TUTORIAL.length - 1)).not.toContain('next page')
    expect(tutorialFooter(TUTORIAL.length - 1)).toContain('finish')
  })
})

describe('the tutorial content itself', () => {
  it('has pages, each with a title and a body', () => {
    expect(TUTORIAL.length).toBeGreaterThan(5)
    for (const page of TUTORIAL) {
      expect(page.title.trim(), JSON.stringify(page.title)).not.toBe('')
      expect(page.body.trim(), page.title).not.toBe('')
    }
  })

  it('fits the bar: no page runs longer than the thread can show', () => {
    // The transcript caps at 260px and scrolls, but a page that needs
    // scrolling to read is a page nobody reads.
    for (const page of TUTORIAL) {
      const lines = page.body.split('\n')
      expect(lines.length, page.title).toBeLessThanOrEqual(12)
      for (const line of lines) {
        expect(line.length, `${page.title}: ${line}`).toBeLessThanOrEqual(78)
      }
    }
  })

  it('covers every mode a new user has to be told about', () => {
    const text = TUTORIAL.map((page) => `${page.title}\n${page.body}\n${page.tip ?? ''}`)
      .join('\n')
      .toLowerCase()

    for (const topic of [
      'agent',
      'talk',
      'teach',
      'esc',
      '/help',
      '/memory',
      '/recall',
      '/save',
      '/run',
      '/key',
      '/aimodel',
      '/history'
    ]) {
      expect(text, topic).toContain(topic)
    }
  })

  it('tells the user how to stop the agent on the page that introduces it', () => {
    // The one instruction that must never be a page-turn away from the
    // feature it protects against.
    const agentPage = TUTORIAL.find((page) => page.title.includes('Agent Mode'))
    expect(agentPage).toBeDefined()
    expect(`${agentPage!.body} ${agentPage!.tip ?? ''}`).toContain('Esc')
  })
})
