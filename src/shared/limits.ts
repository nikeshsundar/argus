import type { AgentAction } from './agent'
import { riskOf } from './safety'

/**
 * Limits: what the agent may ever do, decided before it starts.
 *
 * Approval (see `safety.ts`) asks about one step at the moment it happens.
 * Limits are the other half of a constrained agent - a boundary set in
 * advance that the agent cannot cross however it was asked or tricked. They
 * are enforced here, in code, from what the machine reports: the title of the
 * window that actually has focus, the address actually being opened. The model
 * is told about them so it can plan inside them, but is never trusted to keep
 * them.
 *
 * Kept free of Electron so every rule can be tested directly.
 */

/** Kinds of action that can be forbidden outright. */
export type Forbidden = 'delete' | 'pay' | 'send' | 'post' | 'install' | 'settings' | 'download'

export const FORBIDDABLE: Forbidden[] = [
  'delete',
  'pay',
  'send',
  'post',
  'install',
  'settings',
  'download'
]

export interface Limits {
  /** Programs the agent may work in. Empty means any. */
  apps: string[]
  /** Sites the agent may open. Empty means any. */
  sites: string[]
  /** Kinds of action that are blocked, not asked about. */
  never: Forbidden[]
  /** Most actions in one task, or null for the built-in ceiling. */
  maxSteps: number | null
  /** Longest a task may run, or null for no limit. */
  maxMinutes: number | null
}

export const NO_LIMITS: Limits = { apps: [], sites: [], never: [], maxSteps: null, maxMinutes: null }

/** A sensible fence for a demo or a first run. */
export const SAFE_PRESET: Limits = {
  apps: [],
  sites: [],
  never: ['delete', 'pay', 'install', 'settings'],
  maxSteps: 40,
  maxMinutes: 5
}

/** Words that give each forbidden kind away, in a step's stated purpose. */
const FORBIDDEN_WORDS: Record<Forbidden, RegExp> = {
  delete: /\b(delete|remove|erase|trash|discard|wipe|uninstall|empty (the )?(bin|trash)|format)\b/i,
  pay: /\b(pay|payment|purchase|buy|checkout|check out|place order|confirm order|transfer|donate|subscribe|upgrade)\b/i,
  send: /\b(send|reply all|forward)\b/i,
  post: /\b(post|publish|tweet|share|comment|upload)\b/i,
  install: /\b(install|uninstall|setup\.exe|\.msi|run as administrator)\b/i,
  settings: /\b(settings|control panel|registry|regedit|password|permission|account settings|privacy settings|sign out|log out)\b/i,
  download: /\b(download|save as)\b/i
}

/** Keys that do a forbidden kind of thing without any visible button. */
const FORBIDDEN_KEYS: Partial<Record<Forbidden, string[]>> = {
  delete: ['delete', 'shift+delete', 'control+shift+delete'],
  send: ['control+enter', 'alt+s']
}

/** Programs that are settings, whatever they are called. */
const SETTINGS_PROGRAMS =
  /\b(settings|control panel|regedit|registry|powershell|cmd|command prompt|terminal|task manager|services|gpedit)\b/i

/**
 * What an app name looks like in a window title.
 *
 * People say "chrome" and "vs code"; Windows titles say "Google Chrome" and
 * "Visual Studio Code". A web app is allowed by its browser window, whose
 * title carries the page's own name - "Inbox - Gmail - Google Chrome".
 */
const APP_ALIASES: Record<string, string[]> = {
  chrome: ['google chrome', 'chrome'],
  edge: ['microsoft edge', 'edge'],
  firefox: ['mozilla firefox', 'firefox'],
  brave: ['brave'],
  'vs code': ['visual studio code'],
  vscode: ['visual studio code'],
  code: ['visual studio code'],
  word: ['word'],
  excel: ['excel'],
  powerpoint: ['powerpoint'],
  outlook: ['outlook'],
  notepad: ['notepad'],
  explorer: ['file explorer'],
  'file explorer': ['file explorer'],
  gmail: ['gmail'],
  'google docs': ['google docs'],
  docs: ['google docs'],
  sheets: ['google sheets'],
  youtube: ['youtube'],
  whatsapp: ['whatsapp'],
  spotify: ['spotify'],
  teams: ['microsoft teams', 'teams'],
  slack: ['slack']
}

function norm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Every way the given allowed app could show up in a title. */
function titleWords(app: string): string[] {
  const key = norm(app)
  return [key, ...(APP_ALIASES[key] ?? [])]
}

/** True when a window title belongs to one of the allowed apps. */
export function titleAllowed(title: string, apps: string[]): boolean {
  const lower = norm(title)
  return apps.some((app) => titleWords(app).some((word) => lower.includes(word)))
}

/** True when a program name is one of the allowed apps. */
export function appAllowed(name: string, apps: string[]): boolean {
  const lower = norm(name)
  return apps.some((app) =>
    titleWords(app).some((word) => lower.includes(word) || word.includes(lower))
  )
}

/** The host of an address, or null when the text is not an address. */
export function hostOf(text: string): string | null {
  const trimmed = text.trim()
  if (/\s/.test(trimmed)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(trimmed)
      ? `https://${trimmed}`
      : null
  if (!withScheme) return null
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** True when `host` is one of the allowed sites or a subdomain of one. */
export function siteAllowed(host: string, sites: string[]): boolean {
  return sites.some((site) => {
    const allowed = (hostOf(site) ?? norm(site)).replace(/^www\./, '')
    return host === allowed || host.endsWith(`.${allowed}`)
  })
}

/** Actions that act on whatever window has focus. */
function actsOnWindow(action: AgentAction): boolean {
  return (
    action.type === 'click' ||
    action.type === 'type' ||
    action.type === 'typeInto' ||
    action.type === 'keys' ||
    action.type === 'scroll'
  )
}

function keySet(keys: string[]): string {
  return keys
    .map((key) => key.trim().toLowerCase().replace(/^ctrl$/, 'control'))
    .sort()
    .join('+')
}

function sortedCombo(combo: string): string {
  return combo.split('+').sort().join('+')
}

/**
 * Why this action is outside the limits, or null when it is inside them.
 *
 * `windowTitle` is the title of the focused window as the OS reports it, or
 * null when it could not be read - in which case the window rule is skipped
 * rather than guessed.
 */
export function checkLimits(
  action: AgentAction,
  limits: Limits,
  context: { windowTitle: string | null }
): string | null {
  // A web lookup touches no window and opens no site on this machine.
  if (action.type === 'done' || action.type === 'wait' || action.type === 'move' || action.type === 'research') {
    return null
  }

  // ---- apps -----------------------------------------------------------
  if (limits.apps.length > 0) {
    if (action.type === 'launch' && !appAllowed(action.name, limits.apps)) {
      return `"${action.name}" is not one of your allowed apps (${limits.apps.join(', ')})`
    }
    if (actsOnWindow(action) && context.windowTitle !== null) {
      if (!titleAllowed(context.windowTitle, limits.apps)) {
        const shown = context.windowTitle.trim() || 'the desktop or taskbar'
        return `the active window "${shorten(shown)}" is not one of your allowed apps (${limits.apps.join(', ')})`
      }
    }
  }

  // ---- sites ----------------------------------------------------------
  if (limits.sites.length > 0) {
    const address =
      action.type === 'openUrl' ? action.url : action.type === 'typeInto' ? action.text : null
    const host = address ? hostOf(address) : null
    if (host && !siteAllowed(host, limits.sites)) {
      return `${host} is not one of your allowed sites (${limits.sites.join(', ')})`
    }
    if (action.type === 'openUrl' && !host) {
      return `"${shorten(action.url)}" is not an address on your allowed sites`
    }
  }

  // ---- never ----------------------------------------------------------
  if (limits.never.length > 0) {
    const purpose = 'purpose' in action ? (action.purpose ?? '') : ''
    // Typing text is never itself a forbidden act - the click that sends or
    // deletes it is. Judging the words someone typed would block writing an
    // email that merely mentions payment.
    const described = action.type === 'type' ? '' : [purpose, riskOf(action) ?? ''].join(' ')

    for (const kind of limits.never) {
      if (described && FORBIDDEN_WORDS[kind].test(described)) {
        return `${label(kind)} is switched off by your limits ("${shorten(purpose || described.trim())}")`
      }
      if (action.type === 'keys') {
        const combo = keySet(action.keys)
        if ((FORBIDDEN_KEYS[kind] ?? []).some((one) => sortedCombo(one) === combo)) {
          return `${label(kind)} is switched off by your limits (${action.keys.join('+')})`
        }
      }
      if (kind === 'settings' && action.type === 'launch' && SETTINGS_PROGRAMS.test(action.name)) {
        return `opening ${action.name} is switched off by your limits`
      }
      if (kind === 'install' && action.type === 'openUrl' && /\.(exe|msi)(\?|$)/i.test(action.url)) {
        return `installing software is switched off by your limits`
      }
    }
  }

  return null
}

function label(kind: Forbidden): string {
  switch (kind) {
    case 'delete':
      return 'Deleting'
    case 'pay':
      return 'Paying or buying'
    case 'send':
      return 'Sending'
    case 'post':
      return 'Posting or sharing'
    case 'install':
      return 'Installing software'
    case 'settings':
      return 'Changing settings'
    case 'download':
      return 'Downloading'
  }
}

function shorten(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

/** True when any limit is set. */
export function hasLimits(limits: Limits): boolean {
  return (
    limits.apps.length > 0 ||
    limits.sites.length > 0 ||
    limits.never.length > 0 ||
    limits.maxSteps !== null ||
    limits.maxMinutes !== null
  )
}

/** One line for the overlay at the start of a run. */
export function limitsLine(limits: Limits): string {
  if (!hasLimits(limits)) return 'No limits set'
  const parts: string[] = []
  if (limits.apps.length) parts.push(`apps: ${limits.apps.join(', ')}`)
  if (limits.sites.length) parts.push(`sites: ${limits.sites.join(', ')}`)
  if (limits.never.length) parts.push(`never: ${limits.never.join(', ')}`)
  if (limits.maxSteps !== null) parts.push(`≤${limits.maxSteps} steps`)
  if (limits.maxMinutes !== null) parts.push(`≤${limits.maxMinutes} min`)
  return `Limits — ${parts.join(' · ')}`
}

/** What the model is told, so it plans inside the fence instead of into it. */
export function limitsForModel(limits: Limits): string {
  if (!hasLimits(limits)) return ''
  const lines = ['The user has set hard limits for this task. They are enforced by the system - any step outside them is blocked and not run:']
  if (limits.apps.length) lines.push(`- Only work in these apps: ${limits.apps.join(', ')}.`)
  if (limits.sites.length) lines.push(`- Only open these sites: ${limits.sites.join(', ')}.`)
  if (limits.never.length) lines.push(`- Never: ${limits.never.map((kind) => label(kind).toLowerCase()).join(', ')}.`)
  if (limits.maxSteps !== null) lines.push(`- At most ${limits.maxSteps} actions in total.`)
  if (limits.maxMinutes !== null) lines.push(`- At most ${limits.maxMinutes} minutes.`)
  lines.push('If the task cannot be done inside these limits, call task_done and say which limit is in the way. Do not try to get around them.')
  return lines.join('\n')
}

/** The full listing for "/limits". */
export function describeLimits(limits: Limits): string {
  const any = (list: string[]): string => (list.length ? list.join(', ') : 'any')
  return [
    `Apps      ${any(limits.apps)}`,
    `Sites     ${any(limits.sites)}`,
    `Never     ${limits.never.length ? limits.never.join(', ') : 'nothing blocked'}`,
    `Steps     ${limits.maxSteps ?? 'no limit'}`,
    `Minutes   ${limits.maxMinutes ?? 'no limit'}`,
    '',
    '/limits apps chrome, gmail          only work in these',
    '/limits sites gmail.com, docs.new   only open these',
    `/limits never delete, pay           block (${FORBIDDABLE.join(', ')})`,
    '/limits steps 25 · /limits minutes 3',
    '/limits safe                        sensible preset',
    '/limits apps any · /limits clear    remove one, or all'
  ].join('\n')
}

export type LimitsCommand =
  | { kind: 'none' }
  | { kind: 'show' }
  | { kind: 'set'; limits: Limits; message: string }
  | { kind: 'bad'; message: string }

const CLEAR_WORDS = ['any', 'none', 'off', 'clear', 'all', 'nothing', 'no limit']

function list(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((one) => one.trim())
    .filter(Boolean)
}

/**
 * Reads "/limits ..." against the current limits.
 *
 * Returns the whole new set rather than a patch, so the caller saves exactly
 * what the message describes.
 */
export function parseLimitsCommand(input: string, current: Limits): LimitsCommand {
  const match = /^\/limits?(?:\s+(.*))?$/i.exec(input.trim())
  if (!match) return { kind: 'none' }
  const rest = (match[1] ?? '').trim()
  if (!rest) return { kind: 'show' }

  const [head = '', ...tail] = rest.split(/\s+/)
  const value = tail.join(' ').trim()
  const clearing = CLEAR_WORDS.includes(value.toLowerCase())

  switch (head.toLowerCase()) {
    case 'clear':
    case 'off':
    case 'none':
      return { kind: 'set', limits: { ...NO_LIMITS }, message: 'All limits removed.' }

    case 'safe':
    case 'demo': {
      const limits = { ...SAFE_PRESET, apps: current.apps, sites: current.sites }
      return { kind: 'set', limits, message: `Safe preset on. ${limitsLine(limits)}` }
    }

    case 'app':
    case 'apps': {
      if (!value) return { kind: 'bad', message: 'Which apps? e.g. "/limits apps chrome, gmail".' }
      const apps = clearing ? [] : list(value.replace(/\b(vs) (code)\b/gi, '$1$2'))
      const limits = { ...current, apps }
      return {
        kind: 'set',
        limits,
        message: apps.length ? `The agent will only work in: ${apps.join(', ')}.` : 'Any app is allowed again.'
      }
    }

    case 'site':
    case 'sites': {
      if (!value) return { kind: 'bad', message: 'Which sites? e.g. "/limits sites gmail.com, docs.google.com".' }
      const sites = clearing ? [] : list(value).map((site) => hostOf(site) ?? site.toLowerCase())
      const limits = { ...current, sites }
      return {
        kind: 'set',
        limits,
        message: sites.length ? `The agent will only open: ${sites.join(', ')}.` : 'Any site is allowed again.'
      }
    }

    case 'never':
    case 'block': {
      if (!value) return { kind: 'bad', message: `Block what? Any of: ${FORBIDDABLE.join(', ')}.` }
      if (clearing) {
        return { kind: 'set', limits: { ...current, never: [] }, message: 'Nothing is blocked outright now.' }
      }
      const asked = list(value).map((one) => one.toLowerCase().replace(/^(paying|payments?|buy(ing)?)$/, 'pay').replace(/^(deleting|deletes?)$/, 'delete').replace(/^(sending|email|mail)$/, 'send'))
      const unknown = asked.filter((one) => !FORBIDDABLE.includes(one as Forbidden))
      if (unknown.length) {
        return { kind: 'bad', message: `Don't know "${unknown.join(', ')}". Pick from: ${FORBIDDABLE.join(', ')}.` }
      }
      const never = [...new Set(asked as Forbidden[])]
      return { kind: 'set', limits: { ...current, never }, message: `Blocked outright: ${never.join(', ')}.` }
    }

    case 'steps':
    case 'minutes':
    case 'mins': {
      const isSteps = head.toLowerCase() === 'steps'
      if (clearing) {
        const limits = isSteps ? { ...current, maxSteps: null } : { ...current, maxMinutes: null }
        return { kind: 'set', limits, message: `No ${isSteps ? 'step' : 'time'} limit.` }
      }
      const amount = Number.parseInt(value, 10)
      const [min, max] = isSteps ? [1, 200] : [1, 60]
      if (!Number.isFinite(amount) || amount < min || amount > max) {
        return { kind: 'bad', message: `Give a number from ${min} to ${max}.` }
      }
      const limits = isSteps ? { ...current, maxSteps: amount } : { ...current, maxMinutes: amount }
      return {
        kind: 'set',
        limits,
        message: isSteps ? `At most ${amount} actions per task.` : `At most ${amount} minutes per task.`
      }
    }

    default:
      return { kind: 'bad', message: `Unknown limit "${head}". Type "/limits" to see them.` }
  }
}

/** Repairs whatever was stored, so a hand-edited settings file cannot crash a run. */
export function healLimits(value: unknown): Limits {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Limits>
  const strings = (items: unknown): string[] =>
    Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []
  const count = (n: unknown, max: number): number | null =>
    typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.min(max, Math.round(n)) : null
  return {
    apps: strings(raw.apps),
    sites: strings(raw.sites),
    never: strings(raw.never).filter((one): one is Forbidden => FORBIDDABLE.includes(one as Forbidden)),
    maxSteps: count(raw.maxSteps, 200),
    maxMinutes: count(raw.maxMinutes, 60)
  }
}
