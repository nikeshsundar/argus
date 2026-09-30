/**
 * Recipes: five built-in workflows that are meant to work every time.
 *
 * A free-form agent run is a model deciding every click, and every click is a
 * chance to be wrong. A recipe is the opposite trade: code does everything
 * that can be known in advance - which page to open (a prefilled Gmail or
 * Calendar link, docs.new), when it has loaded, what to paste - and the model
 * does only what it is actually good at: writing, researching, reading the
 * screen. Irreversible steps (Send, Save) still go through the agent, so the
 * approval card and limits apply exactly as elsewhere.
 *
 * This file holds the pure parts: parsing the commands, building the links,
 * and turning text into the HTML that Docs and Sheets paste with formatting.
 */

export type RecipeKind = 'brief' | 'sheet' | 'mail' | 'meet' | 'launch' | 'menu'

export interface RecipeCommand {
  kind: RecipeKind
  /** Everything after the command word. */
  arg: string
}

const COMMANDS: Record<string, RecipeKind> = {
  brief: 'brief',
  research: 'brief',
  sheet: 'sheet',
  table: 'sheet',
  mail: 'mail',
  email: 'mail',
  meet: 'meet',
  meeting: 'meet',
  launch: 'launch',
  wow: 'menu',
  recipes: 'menu'
}

/** Reads "/brief ai agents" and the rest. Null for anything else. */
export function parseRecipe(input: string): RecipeCommand | null {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(input.trim())
  if (!match) return null
  const kind = COMMANDS[match[1]!.toLowerCase()]
  return kind ? { kind, arg: (match[2] ?? '').trim() } : null
}

/** What each one needs to be given, for the menu and for mistakes. */
export const RECIPE_USAGE: Record<Exclude<RecipeKind, 'menu'>, string> = {
  brief: '/brief <topic> — 4 AI researchers search the web at once and write a formatted Google Doc',
  sheet: '/sheet — turns the table on your screen into a real Google Sheet',
  mail: '/mail <email> <what to say> — one sentence becomes a full email, ready to send',
  meet: '/meet <who, when, what> — one sentence becomes a Google Calendar invite',
  launch: '/launch <product> — 5 writers at once build a launch kit in a Google Doc'
}

export function recipeMenu(): string {
  return [
    'Five one-line workflows:',
    '',
    `1. ${RECIPE_USAGE.brief}`,
    '   e.g. /brief AI agents in healthcare',
    `2. ${RECIPE_USAGE.sheet}`,
    '   open any page with a table, press the hotkey, type /sheet',
    `3. ${RECIPE_USAGE.mail}`,
    '   e.g. /mail priya@example.com the demo moved to Friday 4pm',
    `4. ${RECIPE_USAGE.meet}`,
    '   e.g. /meet with priya@example.com tomorrow 4pm about the demo',
    `5. ${RECIPE_USAGE.launch}`,
    '   e.g. /launch Argus, an AI that safely operates your PC',
    '',
    'Google Docs, Sheets, Gmail and Calendar open in your default browser - sign in to Google there first.'
  ].join('\n')
}

/** Every email address in the text, in order, without repeats. */
export function extractEmails(text: string): string[] {
  const found = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []
  return [...new Set(found.map((one) => one.toLowerCase()))]
}

/** A Gmail compose window with everything already filled in. */
export function gmailComposeUrl(mail: { to: string; subject: string; body: string }): string {
  const query = [
    'view=cm',
    'fs=1',
    `to=${encodeURIComponent(mail.to)}`,
    `su=${encodeURIComponent(mail.subject)}`,
    `body=${encodeURIComponent(mail.body)}`
  ].join('&')
  return `https://mail.google.com/mail/?${query}`
}

export interface Meeting {
  title: string
  /** Local wall-clock start, "YYYY-MM-DDTHH:MM". */
  start: string
  durationMinutes: number
  description: string
  location: string
  guests: string[]
}

/** "2026-10-02T16:00" plus minutes, as Calendar's "20261002T160000". */
export function calendarStamp(local: string, plusMinutes = 0): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local.trim())
  if (!match) return null
  const [, y, mo, d, h, mi] = match.map(Number) as number[]
  // UTC arithmetic on purpose: this is wall-clock time, and the timezone is
  // passed to Calendar separately. Using local Date here would shift it twice.
  const at = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi! + plusMinutes))
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}00`
  )
}

/** A Google Calendar new-event page, filled in. Null if the time is unusable. */
export function calendarUrl(meeting: Meeting, timeZone: string): string | null {
  const start = calendarStamp(meeting.start)
  const end = calendarStamp(meeting.start, Math.max(5, Math.min(24 * 60, meeting.durationMinutes || 30)))
  if (!start || !end) return null
  const params = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(meeting.title)}`,
    `dates=${start}/${end}`,
    `ctz=${encodeURIComponent(timeZone)}`,
    ...(meeting.description ? [`details=${encodeURIComponent(meeting.description)}`] : []),
    ...(meeting.location ? [`location=${encodeURIComponent(meeting.location)}`] : []),
    ...(meeting.guests.length ? [`add=${encodeURIComponent(meeting.guests.join(','))}`] : [])
  ]
  return `https://calendar.google.com/calendar/render?${params.join('&')}`
}

/** Pulls the first JSON object out of a model reply. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) return null
  try {
    const value = JSON.parse(json) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** **bold** inside a line, after escaping. */
function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
}

/**
 * The small bit of markdown writers use, as HTML Google Docs pastes well:
 * headings, "- " and "1. " lists, **bold**, and paragraphs.
 */
export function markdownToHtml(markdown: string): string {
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  const closeList = (): void => {
    if (list) out.push(`</${list}>`)
    list = null
  }

  for (const raw of markdown.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (!line) {
      closeList()
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line)

    if (heading) {
      closeList()
      const level = Math.min(3, heading[1]!.length + 1)
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`)
    } else if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol'
      if (list !== kind) {
        closeList()
        out.push(`<${kind}>`)
        list = kind
      }
      out.push(`<li>${inline((bullet ?? numbered)![1]!)}</li>`)
    } else {
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  return out.join('')
}

/** The same text with the markdown marks taken out, for a plain-text paste. */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim()
}

export interface DocSection {
  heading: string
  markdown: string
}

/** A whole document - title, subtitle, sections - as HTML and as plain text. */
export function buildDoc(doc: { title: string; subtitle: string; sections: DocSection[] }): {
  html: string
  text: string
} {
  const html = [
    `<h1>${escapeHtml(doc.title)}</h1>`,
    `<p><i>${escapeHtml(doc.subtitle)}</i></p>`,
    ...doc.sections.map(
      (section) => `<h2>${escapeHtml(section.heading)}</h2>${markdownToHtml(section.markdown)}`
    )
  ].join('')
  const text = [
    doc.title,
    doc.subtitle,
    ...doc.sections.map((section) => `${section.heading}\n\n${markdownToPlain(section.markdown)}`)
  ].join('\n\n')
  return { html: `<meta charset="utf-8">${html}`, text }
}

export interface Table {
  title: string
  headers: string[]
  rows: string[][]
}

/** Cleans a table read off the screen: even rows, no blank ones, capped. */
export function normaliseTable(raw: Record<string, unknown>): Table | null {
  if (raw['found'] === false) return null
  const cells = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim())) : []
  const headers = cells(raw['headers'])
  const rows = (Array.isArray(raw['rows']) ? raw['rows'] : [])
    .map(cells)
    .filter((row) => row.some(Boolean))
    .slice(0, 500)
  if (rows.length === 0) return null
  const width = Math.max(headers.length, ...rows.map((row) => row.length))
  const pad = (row: string[]): string[] => [...row, ...Array(Math.max(0, width - row.length)).fill('')]
  return {
    title: typeof raw['title'] === 'string' ? raw['title'].trim() : '',
    headers: headers.length ? pad(headers) : [],
    rows: rows.map(pad)
  }
}

/** A table as HTML (Sheets pastes it into cells, header in bold) and as TSV. */
export function tableClipboard(table: Table): { html: string; text: string } {
  const clean = (cell: string): string => cell.replace(/[\t\r\n]+/g, ' ')
  const head = table.headers.length
    ? `<tr>${table.headers.map((cell) => `<th><b>${escapeHtml(cell)}</b></th>`).join('')}</tr>`
    : ''
  const body = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')
  const lines = [...(table.headers.length ? [table.headers] : []), ...table.rows].map((row) =>
    row.map(clean).join('\t')
  )
  return {
    html: `<meta charset="utf-8"><table>${head}${body}</table>`,
    text: lines.join('\n')
  }
}

/** "Fri 2 Oct, 4:00 pm" for the summary line. */
export function describeWhen(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local.trim())
  if (!match) return local
  const [, y, mo, d, h, mi] = match.map(Number) as number[]
  const date = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!))
  const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  const hour = h! % 12 || 12
  return `${day}, ${hour}:${String(mi).padStart(2, '0')} ${h! < 12 ? 'am' : 'pm'}`
}
