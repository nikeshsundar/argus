/**
 * The built-in tutorial.
 *
 * Argus has no window, no menu and no settings screen, which is the point -
 * and also the problem. Everything is behind one hotkey and a handful of slash
 * commands, so a new user's first minute is a blank bar and no way to find out
 * what it does. "/help" lists the commands, but a list of commands is a
 * reference, not an introduction.
 *
 * Two rules shape what is here. It runs entirely in the renderer, so it works
 * before an API key has ever been set - the moment someone most needs it is the
 * moment the app cannot answer anything. And it only ever describes; a tutorial
 * that reached for the mouse to demonstrate Agent Mode would be teaching the
 * feature by doing the exact thing the user has not yet agreed to.
 */

export interface TutorialPage {
  /** Shown as the question line, so it reads like the user asked for it. */
  title: string
  /** The explanation. Kept to a few short lines - this renders in a bar. */
  body: string
  /** The one thing to actually try before moving on. Optional. */
  tip?: string
}

export const TUTORIAL: TutorialPage[] = [
  {
    title: 'What Argus is',
    body: [
      'Argus lives in your system tray and does nothing until you call it.',
      'Press the hotkey and it captures your screen once, then answers a',
      'question about it — or takes the keyboard and finishes the task.',
      '',
      'No account. No Argus server. Your key, your machine, your screen.'
    ].join('\n'),
    tip: 'The hotkey is Alt + `  — the key above Tab, left of 1.'
  },
  {
    title: 'Agent Mode — the default',
    body: [
      'Type what you want done and press Enter. That is the whole thing.',
      '',
      '  open vs code and go to github',
      '  play the next song',
      '  turn on dark mode',
      '',
      'Argus looks at the screen, takes one action, looks again, and repeats',
      'until it is done. A red frame covers the screen the entire time.'
    ].join('\n'),
    tip: 'Esc stops it instantly, from anywhere, whatever has focus.'
  },
  {
    title: 'Talk Mode — asking instead',
    body: [
      'Anything that reads like a question is answered, not performed:',
      '',
      '  what does this error mean?',
      '  who is this creator',
      '  summarise this page',
      '',
      'A question mark, an opening question word, or a verb aimed at Argus',
      'rather than the machine — any of those is enough.'
    ].join('\n'),
    tip: 'Start with "ask" to force it: ask open instagram'
  },
  {
    title: 'The chip decides ties',
    body: [
      'The chip on the left of the bar says what Enter will do before you',
      'press it — Agent, Talk or Teach. It updates as you type.',
      '',
      'If it guessed wrong, click it. That pins the mode for this one',
      'request, then it goes back to reading your wording.'
    ].join('\n'),
    tip: 'Look at the chip before pressing Enter on anything destructive.'
  },
  {
    title: 'Follow-up questions',
    body: [
      'Answers keep their thread. Ask "how many subscribers?" straight after',
      '"who is this creator?" and it knows what you mean — no re-explaining.',
      '',
      'Threads are saved as text and can be picked up later.'
    ].join('\n'),
    tip: '/history reopens a past chat · /new starts a fresh one'
  },
  {
    title: 'Teach Mode — learn it yourself',
    body: [
      'Agent Mode does the work and leaves you no wiser. Teach Mode is the',
      'other trade: Argus draws a ghost cursor on your real screen, points at',
      'each step, and waits while you do it.',
      '',
      '  teach me how to add a transition in davinci resolve',
      '  walk me through creating a github repo'
    ].join('\n'),
    tip: 'Triggers: teach me · show me how · walk me through · guide me through'
  },
  {
    title: 'Talking to it',
    body: [
      'Click the microphone, speak, click again to stop.',
      '',
      'A question is sent as soon as it is transcribed. Anything that would',
      'take control waits on your Enter instead — speech misheard by one word',
      'is a wasted turn in Talk, and a mouse in the wrong place in Agent.'
    ].join('\n'),
    tip: 'The bar turns red while the microphone is live. Esc discards it.'
  },
  {
    title: 'Screen memory',
    body: [
      'Off by default. Turned on, Argus keeps a rolling few minutes of your',
      'screen in memory — never on disk — so you can ask about something that',
      'is already gone: the dialog you dismissed, the tab you closed.',
      '',
      'A red pill sits in the bar the whole time it is running.'
    ].join('\n'),
    tip: '/memory on · /recall what was that error · /memory off'
  },
  {
    title: 'Saving a run',
    body: [
      'When an Agent run does something you will want again, keep it:',
      '',
      '  /save morning-standup',
      '  /run morning-standup',
      '',
      'A replay repeats the recorded actions directly. No model call, so it',
      'is instant and costs nothing.'
    ].join('\n'),
    tip: '/workflows lists everything you have saved.'
  },
  {
    title: 'Picking the model',
    body: [
      'Argus has no AI of its own — you point it at one. Google\'s Gemini',
      'free tier needs no card and takes about a minute to set up.',
      '',
      '  /key AIza…            add a key',
      '  /aimodel              pick which model answers',
      '',
      'Out of quota? Add a second key from a different Google project —',
      'quota is counted per project, and Argus rotates between them.'
    ].join('\n'),
    tip: 'Get one free at aistudio.google.com/apikey'
  },
  {
    title: 'That is everything',
    body: [
      'You now know every mode Argus has.',
      '',
      '  /help        every command, in one list',
      '  /hotkey      rebind Alt + `',
      '  /cursor      how fast the agent moves the pointer',
      '  /tutorial    run this again, any time',
      '',
      'Close the bar with Esc and try it on whatever is behind this window.'
    ].join('\n')
  }
]

/** What "/tutorial …" was asking for. */
export type TutorialCommand =
  | { kind: 'none' }
  | { kind: 'start' }
  | { kind: 'next' }
  | { kind: 'back' }
  | { kind: 'exit' }
  /** Zero-based, already clamped to a real page. */
  | { kind: 'jump'; index: number }

const TUTORIAL_PREFIX = /^\/tutorial\b\s*(.*)$/is

/**
 * Parses the command and its one optional argument.
 *
 * A page number is 1-based for the user and clamped rather than rejected:
 * "/tutorial 99" should land on the last page, not produce an error about a
 * tutorial they have not started yet.
 */
export function parseTutorialCommand(text: string): TutorialCommand {
  const match = TUTORIAL_PREFIX.exec(text.trim())
  if (!match) return { kind: 'none' }

  const argument = (match[1] ?? '').trim().toLowerCase()
  if (!argument) return { kind: 'start' }

  if (/^(next|n|more)$/.test(argument)) return { kind: 'next' }
  if (/^(back|b|prev|previous)$/.test(argument)) return { kind: 'back' }
  if (/^(exit|quit|stop|done|close|end)$/.test(argument)) return { kind: 'exit' }

  const page = /^(\d+)$/.exec(argument)
  if (page) return { kind: 'jump', index: clampPage(Number(page[1]) - 1) }

  // Anything else is a typo, and restarting is the least surprising reading of
  // "/tutorial <something>" - there is nothing here worth failing over.
  return { kind: 'start' }
}

/** Keeps an index inside the tutorial, however it was arrived at. */
export function clampPage(index: number): number {
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), TUTORIAL.length - 1)
}

/** True once there is nothing after this page. */
export function isLastPage(index: number): boolean {
  return clampPage(index) === TUTORIAL.length - 1
}

/** The line under the page: where you are, and what the keys do. */
export function tutorialFooter(index: number): string {
  const page = clampPage(index)
  const where = `${page + 1} of ${TUTORIAL.length}`
  const controls = isLastPage(page)
    ? 'Enter or Esc to finish · "/tutorial back" to go back'
    : 'Enter for the next page · "/tutorial back" · "/tutorial exit"'
  return `${where} — ${controls}`
}
