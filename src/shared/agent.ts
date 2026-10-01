import { riskOf } from './safety'

/**
 * What the model says an action is for. Read by the safety check, which asks
 * the user before anything irreversible - see `shared/safety.ts`.
 */
export interface Intent {
  /** In the user's terms: "Click Send", "Delete the selected file". */
  purpose?: string
  /** Raised by the model for anything that sends, pays, deletes or installs. */
  sensitive?: boolean
}

/**
 * Actions the model may take while driving the computer.
 *
 * Coordinates are normalised to a 0-1000 grid in both axes, independent of the
 * user's resolution - the same convention Gemini uses for pointing. They are
 * converted to physical pixels by `toScreenPoint` at execution time.
 */
export type AgentAction = AgentActionKind & {
  /** Which item of the run's to-do list this action is for (1-based). */
  todo?: number
}

type AgentActionKind =
  | { type: 'launch'; name: string }
  | { type: 'openUrl'; url: string }
  | ({ type: 'click'; x: number; y: number; button: 'left' | 'right'; double: boolean } & Intent)
  | { type: 'move'; x: number; y: number }
  | ({ type: 'type'; text: string } & Intent)
  /**
   * Click a field, type into it, optionally submit - in one turn.
   *
   * The same work as click + type_text + press_keys, which is three model round
   * trips for the single commonest thing anyone does: put text in a box. On a
   * free tier capped at 20 requests a day, collapsing that to one is the
   * difference between finishing a task and running out halfway.
   */
  | ({ type: 'typeInto'; x: number; y: number; text: string; submit: boolean } & Intent)
  | ({ type: 'keys'; keys: string[] } & Intent)
  | { type: 'scroll'; direction: 'up' | 'down'; clicks: number }
  | { type: 'wait'; seconds: number }
  /**
   * Look facts up with Google Search instead of recalling them.
   *
   * Without this the agent had nowhere to get a figure it could not see, so it
   * typed one from memory - confidently, and wrong. Not a desktop action: the
   * loop runs it and hands the sourced answer back as the call's result.
   */
  | { type: 'research'; query: string }
  /**
   * `evidence` is what the model says it can see that proves the task is
   * done - checked independently before the run is allowed to end.
   */
  | { type: 'done'; summary: string; evidence?: string }

/** Most actions run from one screenshot before the agent must look again. */
export const MAX_BATCH = 6

/**
 * Decides which of a turn's function calls actually run.
 *
 * Batching is what makes the agent quick - a click and the text that follows
 * it do not need two round trips. But two things in a batch are unsafe, and
 * both are what made the agent report work it had never checked:
 *
 * - task_done alongside other actions. That is claiming success for a result
 *   nobody has looked at yet. It is refused, and the model is told to look.
 * - Anything after an action that changes the screen wholesale (opening an
 *   app, loading a page, submitting). Its coordinates were read off a screen
 *   that is about to be gone.
 *
 * `presets` is aligned with the input: a string for each call that was not
 * run, saying why, so the model gets an honest answer for every call it made.
 */
export function planBatch(calls: AgentAction[]): {
  actions: AgentAction[]
  presets: (string | undefined)[]
} {
  if (calls.length === 1) return { actions: calls, presets: [undefined] }

  // Looking something up comes before using it. A turn that asks for a
  // web_search runs only that: everything else in it was planned before the
  // answer existed, so any figure it would type is a guess.
  const lookup = calls.find((call) => call.type === 'research')
  if (lookup) {
    return {
      actions: [lookup],
      presets: calls.map((call) =>
        call === lookup ? undefined : 'skipped - web_search runs alone; act on its result next turn'
      )
    }
  }

  const onlyDone = calls.find((call) => call.type === 'done')
  if (onlyDone && calls.every((call) => call.type === 'done')) {
    return { actions: [onlyDone], presets: calls.map(() => undefined) }
  }

  const actions: AgentAction[] = []
  const presets: (string | undefined)[] = []
  let blocked: string | null = null

  for (const call of calls) {
    if (call.type === 'done') {
      presets.push(
        'not accepted: task_done must be called on its own, after you have checked the result in the next screenshot'
      )
    } else if (blocked) {
      presets.push(blocked)
    } else if (actions.length >= MAX_BATCH) {
      presets.push(`skipped - at most ${MAX_BATCH} actions per turn; do it next turn if still needed`)
    } else {
      actions.push(call)
      presets.push(undefined)
      if (changesScreen(call)) {
        blocked = 'skipped - an earlier action in the batch changed the screen; look at the new screenshot first'
      } else if (riskOf(call)) {
        // Whatever follows a send or a delete was planned before anyone
        // approved it, against a screen it is about to change.
        blocked = 'skipped - an earlier action in the batch needed approval; look at the new screenshot first'
      }
    }
  }
  return { actions, presets }
}

/** True for actions after which the old screenshot no longer describes the screen. */
export function changesScreen(action: AgentAction): boolean {
  return (
    action.type === 'launch' ||
    action.type === 'openUrl' ||
    (action.type === 'typeInto' && action.submit)
  )
}

export interface ScreenSize {
  width: number
  height: number
}

/** Maps a normalised 0-1000 coordinate onto a physical screen pixel. */
export function toScreenPoint(
  x: number,
  y: number,
  screen: ScreenSize
): { x: number; y: number } {
  const clamp = (value: number): number => Math.min(1000, Math.max(0, value))
  return {
    x: Math.round((clamp(x) / 1000) * (screen.width - 1)),
    y: Math.round((clamp(y) / 1000) * (screen.height - 1))
  }
}

/** One-line description of an action, shown live in the bar as the agent works. */
export function describeAction(action: AgentAction): string {
  switch (action.type) {
    case 'launch':
      return `Open ${action.name}`
    case 'openUrl':
      return `Open ${action.url}`
    case 'click':
      if (action.purpose) return action.purpose
      return `${action.double ? 'Double-click' : action.button === 'right' ? 'Right-click' : 'Click'} at ${action.x},${action.y}`
    case 'move':
      return `Move to ${action.x},${action.y}`
    case 'type':
      return `Type "${action.text.length > 40 ? `${action.text.slice(0, 40)}…` : action.text}"`
    case 'typeInto': {
      const shown = action.text.length > 30 ? `${action.text.slice(0, 30)}…` : action.text
      return `Type "${shown}" at ${action.x},${action.y}${action.submit ? ' and press Enter' : ''}`
    }
    case 'keys':
      return action.purpose
        ? `${action.purpose} (${action.keys.join('+')})`
        : `Press ${action.keys.join('+')}`
    case 'scroll':
      return `Scroll ${action.direction}`
    case 'wait':
      return `Wait ${action.seconds}s`
    case 'research':
      return `Search the web: "${action.query.length > 60 ? `${action.query.slice(0, 60)}…` : action.query}"`
    case 'done':
      return action.summary
  }
}

/**
 * Turns a literal backslash-n into a line break.
 *
 * Models sometimes escape newlines twice in function arguments, and the email
 * went out reading "Hi,\n\nI am Argus". Only when the text has no real line
 * breaks at all - text that already has them is taken as meant, so code that
 * genuinely contains "\n" survives.
 */
export function realLineBreaks(text: string): string {
  if (text.includes('\n')) return text
  return text.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, '\t')
}

/**
 * True when the focused window is a spreadsheet.
 *
 * type_into clears a field with Ctrl+A before typing, and presses Delete
 * before Enter to drop a browser's autocomplete. In a spreadsheet Ctrl+A
 * selects the whole sheet and Delete then clears it - which is how an agent
 * run erased the rows it had just written, and rewrote them, for twenty
 * minutes. Typing into a selected cell already replaces it, so neither key is
 * needed there.
 */
export function isSpreadsheetTitle(title: string | null): boolean {
  return title !== null && /google sheets|\bexcel\b|libreoffice calc|\bspreadsheet\b|\.xlsx\b|\.csv\b/i.test(title)
}

/** Endings that make a bare word a web address - and not a file name. */
const WEB_ENDINGS = new Set(
  (
    'com org net io ai tech dev app co in me gov edu xyz info site online store shop ' +
    'uk us ca au de fr jp cn ru br it es nl se no ch be at dk fi ie nz sg hk kr ' +
    'tv gg ly so to fm sh cc biz pro page link blog news live cloud digital agency ' +
    'studio design space website world today academy school global media network ' +
    'systems solutions software tools group team life new'
  ).split(' ')
)

/**
 * A bare domain, given the scheme that makes a browser open it.
 *
 * "nivonto.tech" typed into an address bar is a search query in every modern
 * browser - it landed the agent on Google's results for the name, which it then
 * reported as having opened the site. The prompt already said to include
 * https:// and the model did not; this does not depend on it listening.
 *
 * Null for anything that is not unmistakably a web address.
 */
export function asWebAddress(text: string): string | null {
  const trimmed = text.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null
  const match = /^((?:[a-z0-9-]+\.)+([a-z]{2,24}))(?::\d+)?(\/\S*)?$/i.exec(trimmed)
  if (!match || trimmed.includes('@')) return null
  return WEB_ENDINGS.has(match[2]!.toLowerCase()) ? `https://${trimmed}` : null
}
