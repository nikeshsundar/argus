import { describe, expect, it } from 'vitest'
import { asWebAddress } from '../src/shared/agent'
import { parseVerdict } from '../src/shared/verify'

describe('asWebAddress', () => {
  it('gives a bare domain its scheme, so the browser opens it instead of searching', () => {
    expect(asWebAddress('nivonto.tech')).toBe('https://nivonto.tech')
    expect(asWebAddress('www.gmail.com/mail/u/0')).toBe('https://www.gmail.com/mail/u/0')
    expect(asWebAddress('docs.new')).toBe('https://docs.new')
  })

  it('leaves full addresses, searches, emails and file names alone', () => {
    expect(asWebAddress('https://nivonto.tech')).toBeNull()
    expect(asWebAddress('what is nivonto.tech')).toBeNull()
    expect(asWebAddress('me@nivonto.tech')).toBeNull()
    expect(asWebAddress('report.pdf')).toBeNull()
    expect(asWebAddress('notes.txt')).toBeNull()
  })
})

describe('parseVerdict', () => {
  it('reads a rejection with its reason', () => {
    expect(
      parseVerdict('{"complete": false, "problem": "This is a Google search page, not nivonto.tech"}')
    ).toEqual({ complete: false, problem: 'This is a Google search page, not nivonto.tech' })
  })

  it('reads an approval, even wrapped in a code fence', () => {
    expect(parseVerdict('```json\n{"complete": true}\n```')).toEqual({ complete: true, problem: '' })
  })

  it('never fails a task over a reply it cannot read', () => {
    expect(parseVerdict('I think so')).toEqual({ complete: true, problem: '' })
    expect(parseVerdict('{broken')).toEqual({ complete: true, problem: '' })
  })
})
