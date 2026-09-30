import { describe, expect, it } from 'vitest'
import {
  buildDoc,
  calendarStamp,
  calendarUrl,
  describeWhen,
  extractEmails,
  gmailComposeUrl,
  markdownToHtml,
  normaliseTable,
  parseRecipe,
  tableClipboard
} from '../src/shared/recipes'

describe('parseRecipe', () => {
  it('reads the five commands, their aliases and the menu', () => {
    expect(parseRecipe('/brief AI agents in healthcare')).toEqual({ kind: 'brief', arg: 'AI agents in healthcare' })
    expect(parseRecipe('/SHEET')).toEqual({ kind: 'sheet', arg: '' })
    expect(parseRecipe('/email a@b.co hi')).toEqual({ kind: 'mail', arg: 'a@b.co hi' })
    expect(parseRecipe('/meeting tomorrow 4pm')).toEqual({ kind: 'meet', arg: 'tomorrow 4pm' })
    expect(parseRecipe('/launch Argus')).toEqual({ kind: 'launch', arg: 'Argus' })
    expect(parseRecipe('/wow')).toEqual({ kind: 'menu', arg: '' })
  })

  it('leaves other commands and plain text alone', () => {
    expect(parseRecipe('/safety on')).toBeNull()
    expect(parseRecipe('/sop do things')).toBeNull()
    expect(parseRecipe('brief me on this')).toBeNull()
  })
})

describe('links', () => {
  it('builds a Gmail compose link with everything filled in', () => {
    const url = gmailComposeUrl({ to: 'priya@example.com', subject: 'Demo & Friday', body: 'Hi Priya,\n\nSee you.' })
    expect(url).toBe(
      'https://mail.google.com/mail/?view=cm&fs=1&to=priya%40example.com&su=Demo%20%26%20Friday&body=Hi%20Priya%2C%0A%0ASee%20you.'
    )
  })

  it('builds a Calendar link in wall-clock time, across midnight', () => {
    expect(calendarStamp('2026-10-02T16:00')).toBe('20261002T160000')
    expect(calendarStamp('2026-10-02T23:45', 30)).toBe('20261003T001500')
    expect(calendarStamp('tomorrow')).toBeNull()

    const url = calendarUrl(
      {
        title: 'Demo review',
        start: '2026-10-02T16:00',
        durationMinutes: 45,
        description: 'Go through the demo',
        location: '',
        guests: ['priya@example.com', 'raj@example.com']
      },
      'Asia/Kolkata'
    )
    expect(url).toBe(
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Demo%20review&dates=20261002T160000/20261002T164500&ctz=Asia%2FKolkata&details=Go%20through%20the%20demo&add=priya%40example.com%2Craj%40example.com'
    )
  })

  it('finds every address once', () => {
    expect(extractEmails('with Priya@Example.com and raj@x.io, and priya@example.com')).toEqual([
      'priya@example.com',
      'raj@x.io'
    ])
  })

  it('says when in words', () => {
    expect(describeWhen('2026-10-02T16:05')).toBe('Fri 2 Oct, 4:05 pm')
    expect(describeWhen('2026-10-02T00:30')).toBe('Fri 2 Oct, 12:30 am')
  })
})

describe('formatting for Docs', () => {
  it('turns writer markdown into headings, lists and bold', () => {
    expect(markdownToHtml('## Risks\n- **Cost** is high\n- Scale\n\n1. First\n2. Second\nDone <ok>')).toBe(
      '<h3>Risks</h3><ul><li><b>Cost</b> is high</li><li>Scale</li></ul><ol><li>First</li><li>Second</li></ol><p>Done &lt;ok&gt;</p>'
    )
  })

  it('builds a whole document as HTML and as plain text', () => {
    const doc = buildDoc({
      title: 'Brief: <AI>',
      subtitle: 'By Argus',
      sections: [{ heading: 'Overview', markdown: '- **Fast** agents' }]
    })
    expect(doc.html).toContain('<h1>Brief: &lt;AI&gt;</h1>')
    expect(doc.html).toContain('<h2>Overview</h2><ul><li><b>Fast</b> agents</li></ul>')
    expect(doc.text).toBe('Brief: <AI>\n\nBy Argus\n\nOverview\n\n- Fast agents')
  })
})

describe('tables for Sheets', () => {
  it('evens out ragged rows, drops blank ones and pastes as cells', () => {
    const table = normaliseTable({
      found: true,
      title: 'Prices',
      headers: ['Item', 'Price', 'Stock'],
      rows: [['Tea', '20'], ['', ''], ['Coffee', '35', 'yes\tfresh']]
    })!
    expect(table.rows).toEqual([
      ['Tea', '20', ''],
      ['Coffee', '35', 'yes\tfresh']
    ])
    const clip = tableClipboard(table)
    expect(clip.text).toBe('Item\tPrice\tStock\nTea\t20\t\nCoffee\t35\tyes fresh')
    expect(clip.html).toContain('<th><b>Item</b></th>')
  })

  it('reports no table when there is none', () => {
    expect(normaliseTable({ found: false, headers: [], rows: [] })).toBeNull()
    expect(normaliseTable({ found: true, headers: ['A'], rows: [['', '']] })).toBeNull()
  })
})
