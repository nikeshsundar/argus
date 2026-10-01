import { describe, expect, it } from 'vitest'
import { isSpreadsheetTitle } from '../src/shared/agent'
import {
  groundingSources,
  parseRecipe,
  researchTablePrompt,
  tableClipboard,
  withSources,
  type Table
} from '../src/shared/recipes'

describe('/sheet with a topic', () => {
  it('passes the topic through, and plain /sheet still reads the screen', () => {
    expect(parseRecipe('/sheet top 10 Indian companies by revenue')).toEqual({
      kind: 'sheet',
      arg: 'top 10 Indian companies by revenue'
    })
    expect(parseRecipe('/sheet')).toEqual({ kind: 'sheet', arg: '' })
  })

  it('asks for researched figures and forbids invented ones', () => {
    const prompt = researchTablePrompt('top 10 Indian companies by revenue', '2026-10-01')
    expect(prompt).toContain('top 10 Indian companies by revenue')
    expect(prompt).toContain('2026-10-01')
    expect(prompt).toMatch(/never invent/i)
    expect(prompt).toMatch(/plain digits/i)
  })
})

describe('groundingSources', () => {
  const payload = (chunks: unknown): unknown => ({ candidates: [{ groundingMetadata: { groundingChunks: chunks } }] })

  it('lists the sites Google Search actually read, once each', () => {
    expect(
      groundingSources(
        payload([
          { web: { title: 'wikipedia.org', uri: 'https://x' } },
          { web: { title: 'moneycontrol.com', uri: 'https://y' } },
          { web: { title: 'wikipedia.org', uri: 'https://z' } }
        ])
      )
    ).toEqual(['wikipedia.org', 'moneycontrol.com'])
  })

  it('falls back to the host when there is no title, and caps the list', () => {
    expect(groundingSources(payload([{ web: { uri: 'https://www.nseindia.com/a' } }]))).toEqual(['nseindia.com'])
    const many = Array.from({ length: 9 }, (_, i) => ({ web: { title: `site${i}.com` } }))
    expect(groundingSources(payload(many))).toHaveLength(5)
  })

  it('returns nothing for an answer that was not grounded', () => {
    expect(groundingSources({ candidates: [{}] })).toEqual([])
    expect(groundingSources(null)).toEqual([])
  })
})

describe('withSources', () => {
  const table: Table = { title: 't', headers: ['Company', 'Revenue (₹ crore)'], rows: [['TCS', '255324']] }

  it('adds a blank row and a sources line, the same width as the table', () => {
    const out = withSources(table, ['wikipedia.org', 'nseindia.com'], '2026-10-01')
    expect(out.rows).toHaveLength(3)
    expect(out.rows[1]).toEqual(['', ''])
    expect(out.rows[2]![0]).toContain('wikipedia.org, nseindia.com')
    expect(out.rows[2]).toHaveLength(2)
    expect(tableClipboard(out).text.split('\n')).toHaveLength(4)
  })

  it('says plainly when the figures were not web-checked', () => {
    expect(withSources(table, [], '2026-10-01').rows[2]![0]).toMatch(/not web-checked/i)
  })
})

describe('isSpreadsheetTitle', () => {
  it('recognises spreadsheet windows', () => {
    expect(isSpreadsheetTitle('Untitled spreadsheet - Google Sheets - Google Chrome')).toBe(true)
    expect(isSpreadsheetTitle('Book1 - Excel')).toBe(true)
    expect(isSpreadsheetTitle('Untitled 1 - LibreOffice Calc')).toBe(true)
  })

  it('leaves everything else alone', () => {
    expect(isSpreadsheetTitle('Inbox - Gmail - Google Chrome')).toBe(false)
    expect(isSpreadsheetTitle('Untitled - Notepad')).toBe(false)
    expect(isSpreadsheetTitle(null)).toBe(false)
  })
})
