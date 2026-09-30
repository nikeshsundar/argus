import { Key, keyboard } from '@nut-tree-fork/nut-js'
import { clipboard, ClipboardItem, shell } from 'electron'
import { checkLimits } from '../shared/limits'
import {
  buildDoc,
  calendarUrl,
  describeWhen,
  extractEmails,
  gmailComposeUrl,
  normaliseTable,
  parseJsonObject,
  tableClipboard,
  type DocSection,
  type RecipeCommand
} from '../shared/recipes'
import { createKeyGate, parallelSavings, SOP_MAX_WRITERS, type SopStep } from '../shared/sop'
import type { AgentStepEvent } from '../shared/types'
import { activeWindowRegion, activeWindowTitle } from './activeWindow'
import { runAgentTask } from './agentLoop'
import { clickHere, glideTo, markTyping, presentGhost } from './cursor'
import { configuredKeys } from './geminiKeys'
import { watchEscape } from './hotkey'
import { hideOverlay, noteOverlay, showOverlay } from './overlayWindow'
import { extractText, requestStep } from './providers/geminiClient'
import { sopModels, writeSopStep, type SopModelOptions } from './providers/geminiSop'
import { ProviderUnavailableError } from './providers/types'
import { MODEL_IMAGE_MIME } from './screenshot'
import { loadSettings } from './settingsStore'

export interface RecipeResult {
  ok: boolean
  summary: string
}

interface Run {
  signal: AbortSignal
  say: (text: string) => void
  keys: string[]
  models: SopModelOptions
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

/**
 * Runs one of the five built-in workflows.
 *
 * `screenshot` is the screen as it was when the bar opened - what /sheet
 * reads. Escape stops any of them, writers included.
 */
export async function runRecipe(
  command: RecipeCommand,
  context: {
    signal: AbortSignal
    screenshot: Buffer | null
    onStep?: (event: AgentStepEvent) => void
  }
): Promise<RecipeResult> {
  const keys = configuredKeys()
  if (keys.length === 0) {
    throw new ProviderUnavailableError('Add a Gemini key first — type "/key <your-key>".')
  }

  const control = new AbortController()
  const stop = (): void => control.abort()
  context.signal.addEventListener('abort', stop, { once: true })
  const unwatch = watchEscape(stop)

  const run: Run = {
    signal: control.signal,
    keys,
    models: sopModels(loadSettings()),
    say: (text) => {
      showOverlay()
      noteOverlay(text)
      context.onStep?.({ description: text, index: 0, max: 0 })
    }
  }

  try {
    switch (command.kind) {
      case 'brief':
        return await brief(command.arg, run)
      case 'launch':
        return await launch(command.arg, run)
      case 'sheet':
        return await sheet(context.screenshot, run)
      case 'mail':
        return await mail(command.arg, run, context.onStep)
      case 'meet':
        return await meet(command.arg, run, context.onStep)
      default:
        return { ok: false, summary: 'Unknown workflow.' }
    }
  } catch (error) {
    if (control.signal.aborted) return { ok: false, summary: 'Stopped.' }
    return { ok: false, summary: error instanceof Error ? error.message : String(error) }
  } finally {
    unwatch()
    context.signal.removeEventListener('abort', stop)
    hideOverlay()
  }
}

// ---- shared moves ---------------------------------------------------------

/**
 * Opens a page in the default browser and waits until its window says it
 * has loaded.
 *
 * Judged by the real window title, not a fixed wait: a slow network gets the
 * time it needs and a fast one is not kept waiting. The title must either
 * change or be given a moment first, so a second run cannot mistake the tab
 * the first run left open for the one it just asked for.
 */
async function openAndWait(url: string, loaded: RegExp, what: string, signal: AbortSignal): Promise<void> {
  const blocked = checkLimits({ type: 'openUrl', url }, loadSettings().limits, { windowTitle: null })
  if (blocked) throw new Error(`Blocked by your limits: ${blocked}`)

  const before = (await activeWindowTitle()) ?? ''
  await shell.openExternal(url)

  const started = Date.now()
  let changed = false
  while (Date.now() - started < 30_000) {
    if (signal.aborted) throw new Error('Stopped.')
    await sleep(300, signal)
    const title = (await activeWindowTitle()) ?? ''
    if (title !== before) changed = true
    if ((changed || Date.now() - started > 2500) && loaded.test(title)) return
  }
  throw new Error(
    `${what} did not finish opening. Check your default browser is signed in to Google, then try again.`
  )
}

/**
 * Pastes formatted content: HTML for Docs and Sheets, plain text for
 * anything else. The user's clipboard text is put back afterwards.
 */
async function pasteRich(content: { html: string; text: string }): Promise<void> {
  const previous = await clipboard.readText().catch(() => '')
  await clipboard.write([new ClipboardItem({ 'text/html': content.html, 'text/plain': content.text })])
  await markTyping()
  await keyboard.pressKey(Key.LeftControl, Key.V)
  await keyboard.releaseKey(Key.LeftControl, Key.V)
  // Docs reads the clipboard as the paste event fires; this only has to
  // outlast that before the user's own clipboard goes back.
  await sleep(900)
  if (previous) await clipboard.writeText(previous)
}

/** The Argus cursor glides into the document and clicks, so the caret is in it. */
async function clickIntoDocument(signal: AbortSignal): Promise<void> {
  const region = await activeWindowRegion()
  if (!region) return
  await presentGhost()
  await glideTo(
    { x: Math.round(region.left + region.width / 2), y: Math.round(region.top + region.height * 0.55) },
    loadSettings().cursorPace,
    signal
  )
  if (signal.aborted) return
  await clickHere('left')
  await sleep(250, signal)
}

/** A new Google Doc, with `doc` pasted into it, formatted. */
async function intoNewDoc(content: { html: string; text: string }, run: Run): Promise<void> {
  run.say('Opening a new Google Doc…')
  await openAndWait('https://docs.new', /Untitled document/i, 'Google Docs', run.signal)
  // The title arrives a beat before the editor will take a paste.
  await sleep(1800, run.signal)
  await clickIntoDocument(run.signal)
  run.say('Writing it into the document…')
  await pasteRich(content)
}

interface Part {
  title: string
  instruction: string
}

/**
 * Writes every part at once, one API key per writer, and measures what that
 * saved. A part that fails comes back as null - the rest still land.
 */
async function writeInParallel(
  parts: Part[],
  goal: string,
  web: boolean,
  run: Run
): Promise<{ texts: (string | null)[]; lanes: number; saved: string }> {
  const lanes = Math.min(run.keys.length, SOP_MAX_WRITERS, parts.length)
  const gate = createKeyGate(lanes)
  const spans: { start: number; end: number }[] = []
  let finished = 0

  const texts = await Promise.all(
    parts.map(async (part, index): Promise<string | null> => {
      const slot = await gate.acquire()
      const start = Date.now()
      try {
        const step: SopStep = {
          id: `p${index + 1}`,
          title: part.title,
          kind: 'write',
          instruction: part.instruction,
          needs: [],
          web
        }
        const text = await writeSopStep({
          step,
          goal,
          inputs: [],
          key: run.keys[slot]!,
          models: run.models,
          signal: run.signal
        })
        spans.push({ start, end: Date.now() })
        finished++
        run.say(`Writer ${slot + 1} finished "${part.title}" — ${finished}/${parts.length} done`)
        return text
      } catch {
        if (run.signal.aborted) throw new Error('Stopped.')
        return null
      } finally {
        gate.release(slot)
      }
    })
  )

  const { workMs, wallMs, savedMs } = parallelSavings(spans)
  const saved =
    spans.length > 1 && savedMs > 0
      ? `${spans.length} writers on ${lanes} key${lanes === 1 ? '' : 's'}: ${seconds(workMs)} of work done in ${seconds(wallMs)} (saved ~${seconds(savedMs)})`
      : ''
  return { texts, lanes, saved }
}

// ---- 1. /brief --------------------------------------------------------------

async function brief(topic: string, run: Run): Promise<RecipeResult> {
  const parts: Part[] = [
    {
      title: 'Overview',
      instruction: `What "${topic}" is and why it matters now, as 5 bullet points starting with "- ". Include concrete facts and numbers where they are known. Use **bold** for the key term in each bullet.`
    },
    {
      title: 'Latest developments',
      instruction: `The most important recent news and developments about "${topic}", as 5 bullet points starting with "- ", newest first, each beginning with the month and year in **bold**.`
    },
    {
      title: 'Key players',
      instruction: `The main companies, people, products or organisations in "${topic}", as 5 bullet points starting with "- ", each "**Name** — one line on why they matter".`
    },
    {
      title: 'Opportunities & risks',
      instruction: `For "${topic}": a line "**Opportunities**" followed by 3 bullet points starting with "- ", then a line "**Risks**" followed by 3 bullet points starting with "- ".`
    }
  ]

  run.say(`Researching "${topic}" — ${parts.length} researchers searching the web at once…`)
  const research = await writeInParallel(parts, `A research brief on ${topic}`, true, run)
  const found = parts
    .map((part, index) => ({ part, text: research.texts[index] }))
    .filter((one): one is { part: Part; text: string } => Boolean(one.text))
  if (found.length === 0) {
    return { ok: false, summary: 'None of the researchers could finish — Gemini may be busy. Try again in a moment.' }
  }

  run.say('Writing the executive summary from the research…')
  let summary = ''
  try {
    summary = await writeSopStep({
      step: {
        id: 'summary',
        title: 'Executive summary',
        kind: 'write',
        instruction:
          'Write a 3-sentence executive summary of the research below: what it is, what is happening now, and the single most important takeaway. Use only facts from the material.',
        needs: [],
        web: false
      },
      goal: `A research brief on ${topic}`,
      inputs: found.map((one) => ({ title: one.part.title, text: one.text })),
      key: run.keys[0]!,
      models: run.models,
      signal: run.signal
    })
  } catch {
    if (run.signal.aborted) throw new Error('Stopped.')
  }

  const sections: DocSection[] = [
    ...(summary ? [{ heading: 'Executive summary', markdown: summary }] : []),
    ...found.map((one) => ({ heading: one.part.title, markdown: one.text }))
  ]
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  await intoNewDoc(
    buildDoc({
      title: `Research brief: ${topic}`,
      subtitle: `Prepared by Argus on ${today} — ${parts.length} AI researchers working in parallel, with live web search.`,
      sections
    }),
    run
  )

  const missing = parts.length - found.length
  return {
    ok: true,
    summary: [
      `Your research brief on "${topic}" is in a new Google Doc — ${sections.length} sections.`,
      research.saved ? `Parallel research: ${research.saved}.` : '',
      missing ? `${missing} section${missing === 1 ? '' : 's'} could not be researched and ${missing === 1 ? 'was' : 'were'} left out.` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
}

// ---- 5. /launch -------------------------------------------------------------

async function launch(product: string, run: Run): Promise<RecipeResult> {
  const parts: Part[] = [
    {
      title: 'LinkedIn post',
      instruction: `A LinkedIn launch post for ${product}. A strong hook as the first line, then 3 short paragraphs, then 3-5 hashtags on the last line. 120-180 words.`
    },
    {
      title: 'X / Twitter thread',
      instruction: `A 5-tweet thread announcing ${product}. Start each tweet with "1/5", "2/5" and so on, each under 270 characters, with a blank line between tweets.`
    },
    {
      title: 'Launch email',
      instruction: `A launch announcement email for ${product}. First line "**Subject:** <subject>", then a blank line, then the body: 120-180 words and one clear call to action.`
    },
    {
      title: 'Instagram caption',
      instruction: `An Instagram caption for the launch of ${product}: 2-4 punchy short lines, emojis welcome, then 8-12 hashtags on the last line.`
    },
    {
      title: '30-second video script',
      instruction: `A 30-second launch video script for ${product}: 5 short scenes. Each scene is a line "**Scene N (0:00-0:06)**" followed by "- Visual: ..." and "- Voiceover: ...".`
    }
  ]

  run.say(`Building the launch kit — ${parts.length} writers working at once…`)
  const result = await writeInParallel(parts, `A launch kit for ${product}`, false, run)
  const sections = parts
    .map((part, index) => ({ heading: part.title, markdown: result.texts[index] ?? '' }))
    .filter((section) => section.markdown)
  if (sections.length === 0) {
    return { ok: false, summary: 'None of the writers could finish — Gemini may be busy. Try again in a moment.' }
  }

  await intoNewDoc(
    buildDoc({
      title: `${product} — Launch Kit`,
      subtitle: `Written by ${parts.length} Argus writers in parallel, each on its own API key.`,
      sections
    }),
    run
  )

  return {
    ok: true,
    summary: [
      `Your launch kit is in a new Google Doc — ${sections.map((section) => section.heading).join(', ')}.`,
      result.saved ? `Parallel writing: ${result.saved}.` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
}

// ---- 2. /sheet --------------------------------------------------------------

const TABLE_PROMPT = `Find the main table on this screenshot - the largest grid or list of structured data (rows and columns). Extract it exactly.

- Copy every value character for character, as shown. Do not calculate, correct, translate or invent anything.
- "headers" is the header row if there is one, otherwise an empty list.
- "rows" is every data row that is fully visible, top to bottom.
- "title" is the table's caption or the page heading above it, if visible.
- If there is no table or structured list on screen, set "found" to false.`

const TABLE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
    title: { type: 'STRING' },
    headers: { type: 'ARRAY', items: { type: 'STRING' } },
    rows: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } }
  },
  required: ['found', 'headers', 'rows']
}

async function sheet(screenshot: Buffer | null, run: Run): Promise<RecipeResult> {
  if (!screenshot) {
    return {
      ok: false,
      summary: 'Open the page with the table, press the Argus hotkey over it, then type /sheet.'
    }
  }

  run.say('Reading the table on your screen…')
  const payload = await requestStep({
    apiKey: run.keys[0]!,
    preferKey: run.keys[0]!,
    ...run.models,
    timeoutMs: 45_000,
    signal: run.signal,
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: MODEL_IMAGE_MIME, data: screenshot.toString('base64') } },
            { text: TABLE_PROMPT }
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
        responseSchema: TABLE_SCHEMA
      }
    }
  })

  const raw = parseJsonObject(extractText(payload))
  const table = raw ? normaliseTable(raw) : null
  if (!table) {
    return {
      ok: false,
      summary: "I couldn't find a table on your screen. Open the page with the table, press the hotkey over it, then type /sheet."
    }
  }

  const columns = Math.max(table.headers.length, table.rows[0]?.length ?? 0)
  run.say(`Found ${table.rows.length} rows × ${columns} columns — opening a new Google Sheet…`)
  await openAndWait('https://sheets.new', /Untitled spreadsheet/i, 'Google Sheets', run.signal)
  // A new sheet starts with A1 selected, so no click is needed - clicking
  // would move the selection and the table would land somewhere else.
  await sleep(2000, run.signal)
  run.say('Filling in the cells…')
  await pasteRich(tableClipboard(table))

  return {
    ok: true,
    summary: `Copied a ${table.rows.length}×${columns} table${table.title ? ` ("${table.title}")` : ''} from your screen into a new Google Sheet.`
  }
}

// ---- 3. /mail ---------------------------------------------------------------

const MAIL_PROMPT = `Write an email the user will send. Return JSON with "subject" and "body".

- The body is plain text: a greeting, then 1-3 short paragraphs, then "Best regards," on its own line.
- Say what the user wants said, clearly and warmly. Do not add facts, promises, dates or names they did not give.
- Do not sign with a name - the user's name is not known.
- The subject is short and specific.
- Write in the same language the user wrote in.`

const MAIL_SCHEMA = {
  type: 'OBJECT',
  properties: { subject: { type: 'STRING' }, body: { type: 'STRING' } },
  required: ['subject', 'body']
}

async function mail(
  arg: string,
  run: Run,
  onStep?: (event: AgentStepEvent) => void
): Promise<RecipeResult> {
  const to = extractEmails(arg)[0]
  const message = to ? arg.replace(new RegExp(to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim() : ''
  if (!to || !message) {
    return { ok: false, summary: 'Who to, and what to say? e.g. /mail priya@example.com the demo moved to Friday 4pm' }
  }

  run.say('Writing your email…')
  const payload = await requestStep({
    apiKey: run.keys[0]!,
    preferKey: run.keys[0]!,
    ...run.models,
    timeoutMs: 25_000,
    signal: run.signal,
    thinking: 'low',
    body: {
      systemInstruction: { parts: [{ text: MAIL_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `To: ${to}\nWhat I want to say: ${message}` }] }],
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json', responseSchema: MAIL_SCHEMA }
    }
  })
  const written = parseJsonObject(extractText(payload))
  const subject = typeof written?.['subject'] === 'string' ? written['subject'].trim() : ''
  const body = typeof written?.['body'] === 'string' ? written['body'].replace(/\\n/g, '\n').trim() : ''
  if (!subject || !body) return { ok: false, summary: 'The email could not be written — try again.' }

  run.say('Opening Gmail with your email already written…')
  await openAndWait(gmailComposeUrl({ to, subject, body }), /Compose Mail/i, 'Gmail', run.signal)
  await sleep(1500, run.signal)

  // Sending is the one irreversible step, so it goes through the agent - and
  // with it the approval card, the limits and the completion check.
  const result = await runAgentTask({
    task: `Send the email to ${to} with the subject "${subject}". It is already fully written in the open Gmail compose window - do not change anything. Click the Send button.`,
    signal: run.signal,
    // One click: a planned list would be a single line that cost a request.
    plan: false,
    ...(onStep ? { onStep } : {})
  })
  return {
    ok: result.ok,
    summary: result.ok ? `Sent to ${to}: "${subject}"\n\n${body}` : result.summary
  }
}

// ---- 4. /meet ---------------------------------------------------------------

const MEET_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    start: { type: 'STRING', description: 'Local start time, YYYY-MM-DDTHH:MM' },
    durationMinutes: { type: 'NUMBER' },
    description: { type: 'STRING' },
    location: { type: 'STRING' }
  },
  required: ['title', 'start', 'durationMinutes']
}

async function meet(
  arg: string,
  run: Run,
  onStep?: (event: AgentStepEvent) => void
): Promise<RecipeResult> {
  if (!arg) {
    return { ok: false, summary: 'Say who, when and what: /meet with priya@example.com tomorrow 4pm about the demo' }
  }

  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  run.say('Working out the meeting…')
  const payload = await requestStep({
    apiKey: run.keys[0]!,
    preferKey: run.keys[0]!,
    ...run.models,
    timeoutMs: 25_000,
    signal: run.signal,
    thinking: 'low',
    body: {
      systemInstruction: {
        parts: [
          {
            text: `Turn the user's request into a calendar event. It is now ${local} (${weekday}), time zone ${timeZone}.

- "start" is local wall-clock time as YYYY-MM-DDTHH:MM. Resolve words like "tomorrow" or "Friday" from today's date. A day with no time means 10:00; no day at all means the next working day.
- "durationMinutes" defaults to 30 unless the request says otherwise.
- "title" is short and specific, e.g. "Demo review with Priya".
- "description" is one line saying what the meeting is for, from the request only.
- "location" only if the request gives one, otherwise empty.`
          }
        ]
      },
      contents: [{ role: 'user', parts: [{ text: arg }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: MEET_SCHEMA }
    }
  })

  const raw = parseJsonObject(extractText(payload))
  const guests = extractEmails(arg)
  const meeting = {
    title: typeof raw?.['title'] === 'string' ? raw['title'].trim() : '',
    start: typeof raw?.['start'] === 'string' ? raw['start'].trim() : '',
    durationMinutes: typeof raw?.['durationMinutes'] === 'number' ? raw['durationMinutes'] : 30,
    description: typeof raw?.['description'] === 'string' ? raw['description'].trim() : '',
    location: typeof raw?.['location'] === 'string' ? raw['location'].trim() : '',
    guests
  }
  const url = meeting.title ? calendarUrl(meeting, timeZone) : null
  if (!url) return { ok: false, summary: "I couldn't work out when that meeting is — try e.g. /meet tomorrow 4pm with priya@example.com" }

  const when = describeWhen(meeting.start)
  run.say(`Opening Google Calendar: "${meeting.title}", ${when}…`)
  await openAndWait(url, /Calendar/i, 'Google Calendar', run.signal)
  await sleep(2000, run.signal)

  const result = await runAgentTask({
    task:
      `Google Calendar's new-event page is open and already filled in: "${meeting.title}", ${when}` +
      `${guests.length ? `, guests ${guests.join(', ')}` : ''}. Do not change anything. Click Save. ` +
      'If Google then asks whether to send invitation emails to the guests, click Send.',
    signal: run.signal,
    // One click: a planned list would be a single line that cost a request.
    plan: false,
    ...(onStep ? { onStep } : {})
  })
  return {
    ok: result.ok,
    summary: result.ok
      ? `Booked "${meeting.title}" — ${when}${guests.length ? `, with ${guests.join(', ')}` : ''}.`
      : result.summary
  }
}
