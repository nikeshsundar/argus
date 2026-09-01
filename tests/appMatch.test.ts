import { describe, expect, it } from 'vitest'
import { bestAppMatch, scoreAppMatch, type AppEntry } from '../src/shared/appMatch'

const INSTALLED: AppEntry[] = [
  { name: 'Visual Studio Code', path: 'code.lnk' },
  { name: 'Google Chrome', path: 'chrome.lnk' },
  { name: 'Chrome Remote Desktop', path: 'crd.lnk' },
  { name: 'Notepad', path: 'notepad.lnk' },
  { name: 'Windows Terminal', path: 'wt.lnk' }
]

describe('scoreAppMatch', () => {
  it('scores an exact name highest', () => {
    expect(scoreAppMatch('Notepad', 'Notepad')).toBe(100)
  })

  it('ignores case, spaces, and punctuation', () => {
    expect(scoreAppMatch('vs code', 'VS Code')).toBe(100)
  })

  it('matches on initials', () => {
    expect(scoreAppMatch('vsc', 'Visual Studio Code')).toBeGreaterThan(0)
  })

  it('gives nothing for an unrelated name', () => {
    expect(scoreAppMatch('spotify', 'Notepad')).toBe(0)
  })
})

describe('bestAppMatch', () => {
  it.each([
    ['vscode', 'Visual Studio Code'],
    ['vs code', 'Visual Studio Code'],
    ['code', 'Visual Studio Code'],
    ['notepad', 'Notepad'],
    ['terminal', 'Windows Terminal']
  ])('resolves %j to %j', (query, expected) => {
    expect(bestAppMatch(query, INSTALLED)?.name).toBe(expected)
  })

  it('prefers the shorter name when both contain the query', () => {
    // "chrome" appears in both Google Chrome and Chrome Remote Desktop.
    expect(bestAppMatch('chrome', INSTALLED)?.name).toBe('Google Chrome')
  })

  it('returns null rather than a bad guess', () => {
    expect(bestAppMatch('photoshop', INSTALLED)).toBeNull()
  })
})
