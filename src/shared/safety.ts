import type { AgentAction } from './agent'
import { externalUrlBlockReason } from './urlSafety'

/**
 * Deciding which agent actions need the user's say-so first.
 *
 * Agent Mode drives the real machine, and some clicks cannot be taken back: an
 * email once sent, a payment once made, a file once deleted. Those must never
 * happen on the model's judgement alone.
 *
 * Two independent checks, so neither has to be perfect:
 *
 * - The model is required to say what each action is for (`purpose`) and to
 *   flag anything irreversible (`sensitive`). It knows what the button is.
 * - This file reads that purpose, the text being submitted, the keys and the
 *   program being opened, and flags risky ones itself. A model that forgets to
 *   raise the flag, or is talked out of it by text on a web page, is still
 *   caught by the words it used to describe the click.
 *
 * Kept free of Electron so the rules can be tested directly.
 */

/**
 * How much Agent Mode asks before acting.
 *
 * - sensitive: only irreversible or outward-facing actions (the default)
 * - every: every single action - for a first run, or a demo
 * - off: never - the user has said they accept the risk
 */
export type ApprovalMode = 'sensitive' | 'every' | 'off'

export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'sensitive'

/**
 * Words that mean the action reaches other people, spends money, or destroys
 * something. Matched on word boundaries against what the model says it is
 * doing - "Click Send", "press Delete", "confirm the order".
 */
const RISKY_WORDS = [
  // Reaches other people. Deliberately not "email", "message" or "reply":
  // opening a mail or a reply box is routine, and a prompt that fires on
  // everything teaches people to click Allow without reading it.
  'send',
  'post',
  'publish',
  'tweet',
  'share',
  'invite',
  'submit',
  // Money
  'pay',
  'payment',
  'purchase',
  'buy',
  'checkout',
  'check out',
  'place order',
  'confirm order',
  'transfer',
  'donate',
  'subscribe',
  'upgrade',
  // Destroys or changes something that matters
  'delete',
  'remove',
  'erase',
  'trash',
  'discard',
  'uninstall',
  'install',
  'format',
  'reset',
  'wipe',
  'overwrite',
  'unsubscribe',
  'deactivate',
  'close account',
  'sign out',
  'log out',
  'password',
  'permission',
  'allow',
  'grant',
  'accept',
  'approve',
  'confirm',
  'authorize',
  'authorise',
  'run as administrator',
  'shutdown',
  'shut down',
  'restart'
]

const RISKY_PATTERN = new RegExp(
  `\\b(${RISKY_WORDS.map((word) => word.replace(/ /g, '\\s+')).join('|')})\\b`,
  'i'
)

/**
 * Programs that can run commands or change the system itself, matched on a
 * squashed form of the name so spacing and punctuation cannot slip one past.
 *
 * `launch_app` takes a free-text name that a fuzzy matcher later resolves to an
 * installed program, so "Power Shell", "powershell_ise" and "Git Bash" all
 * reach a shell. The window-boundary regex this replaced missed every one of
 * those. Substrings catch the descriptive names; the exact set holds the short
 * ones ("wt", "cmd") that would false-positive as a substring of ordinary apps.
 */
const RISKY_LAUNCH_SUBSTRINGS = [
  'powershell',
  'commandprompt',
  'terminal',
  'regedit',
  'registry',
  'diskpart',
  'taskmgr',
  'taskmanager',
  'controlpanel',
  'grouppolicy',
  'gpedit',
  'computermanagement',
  'diskmanagement',
  'gitbash',
  'bash',
  'python',
  'mshta',
  'cscript',
  'wscript',
  'cmder'
]

/** Short program names that are risky exactly, but common as substrings. */
const RISKY_LAUNCH_EXACT = new Set(['wt', 'cmd', 'pwsh', 'mmc', 'wsl', 'sh', 'services'])

/** True when launching this (fuzzy) program name could run commands. */
function launchIsRisky(name: string): boolean {
  const squashed = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!squashed) return false
  return RISKY_LAUNCH_EXACT.has(squashed) || RISKY_LAUNCH_SUBSTRINGS.some((token) => squashed.includes(token))
}

/**
 * Win+R opens the Run dialog, which runs any command typed into it. The keys
 * carry no Enter or Delete, so the committing-step check below would wave them
 * past; this names the combination so the user is asked before the dialog that
 * turns "type then Enter" into arbitrary execution even appears.
 */
function isRunDialog(keys: string[]): boolean {
  const pressed = keys.map((key) => key.trim().toLowerCase())
  const hasMeta = pressed.some((key) => ['super', 'win', 'meta', 'cmd', 'command'].includes(key))
  return pressed.length === 2 && pressed.includes('r') && hasMeta
}

/** Key combinations that send or destroy without a visible button. */
const RISKY_KEYS: string[][] = [
  ['control', 'enter'], // send in Gmail, Outlook, Slack, Teams
  ['ctrl', 'enter'],
  ['alt', 's'], // send in Outlook
  ['delete'],
  ['shift', 'delete'], // permanent delete, bypasses the Recycle Bin
  ['control', 'shift', 'delete']
]

/** URLs that take money or credentials. */
const RISKY_URL = /(checkout|\/pay|payment|billing|transfer|\/buy|purchase|password|signin|login)/i

function keySet(keys: string[]): string {
  return keys
    .map((key) => key.trim().toLowerCase().replace(/^ctrl$/, 'control'))
    .sort()
    .join('+')
}

const RISKY_KEY_SETS = new Set(RISKY_KEYS.map(keySet))

/**
 * Why this action needs approval, or null when it is routine.
 *
 * The reason is shown to the user verbatim, so it says what will happen in
 * their terms rather than which rule fired.
 */
export function riskOf(action: AgentAction): string | null {
  const purpose = 'purpose' in action ? action.purpose?.trim() : undefined
  const flagged = 'sensitive' in action && action.sensitive === true

  // Putting text in a box commits nothing - it can be read, edited or
  // deleted before anything is sent. Asking about it, however the model
  // labelled it, only buries the one question that matters (the Send click)
  // under several that do not.
  if (!canCommit(action)) return null

  if (flagged) return purpose || 'The agent marked this step as sensitive.'
  if (purpose && RISKY_PATTERN.test(purpose)) return purpose

  switch (action.type) {
    case 'launch':
      return launchIsRisky(action.name)
        ? `Open ${action.name}, which can change system settings or run commands`
        : null

    case 'openUrl': {
      // A scheme the OS could turn into a program launch or a file read is
      // refused outright at execution time; here it is also surfaced as the
      // reason the user is asked, rather than a bare "Open <url>".
      const unopenable = externalUrlBlockReason(action.url)
      if (unopenable) return unopenable
      return RISKY_URL.test(action.url) ? `Open ${action.url}` : null
    }

    case 'keys':
      if (isRunDialog(action.keys)) {
        return purpose || 'Press Win+R to open the Run dialog, which can run any command'
      }
      if (RISKY_KEY_SETS.has(keySet(action.keys))) {
        return purpose || `Press ${action.keys.join('+')}, which can send or delete`
      }
      // Enter on a focused Send button sends. With no stated purpose there is
      // no telling which button has focus, so it is asked about.
      if (!purpose && keySet(action.keys) === 'enter') {
        return 'Press Enter (it may activate a focused Send or Submit button)'
      }
      return null

    case 'typeInto':
      // Pressing Enter on a form is how most things get sent. Searches and
      // addresses are routine; a submission whose purpose is unknown is not.
      if (action.submit && !purpose && !looksLikeNavigation(action.text)) {
        return `Type "${shorten(action.text)}" and press Enter`
      }
      return null

    default:
      return null
  }
}

/**
 * Whether this action could send, submit or destroy anything by itself.
 *
 * Typing without Enter cannot, and neither can keys that only move, select or
 * copy. Clicks can - any button might be Send - so they always count.
 */
function canCommit(action: AgentAction): boolean {
  switch (action.type) {
    case 'type':
      return false
    case 'typeInto':
      return action.submit
    case 'keys':
      return (
        isRunDialog(action.keys) ||
        action.keys.some((key) => /^(enter|return|delete|del|backspace|alt|f4)$/i.test(key.trim()))
      )
    case 'scroll':
    case 'wait':
    case 'move':
    case 'research':
    case 'done':
      return false
    default:
      return true
  }
}

/** Addresses and short search terms, which submitting cannot do harm with. */
function looksLikeNavigation(text: string): boolean {
  const trimmed = text.trim()
  return /^https?:\/\//i.test(trimmed) || (trimmed.length <= 60 && !trimmed.includes('\n'))
}

function shorten(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

/** Whether to stop and ask before running this action. */
export function needsApproval(
  action: AgentAction,
  mode: ApprovalMode
): { ask: boolean; reason: string } {
  if (action.type === 'done' || mode === 'off') return { ask: false, reason: '' }
  const risk = riskOf(action)
  if (risk) return { ask: true, reason: risk }
  if (mode === 'every') return { ask: true, reason: '' }
  return { ask: false, reason: '' }
}

export type SafetyCommand = { kind: 'none' } | { kind: 'status' } | { kind: 'set'; mode: ApprovalMode } | { kind: 'bad'; raw: string }

/** Reads "/safety", "/safety every", "/safety off" and friends. */
export function parseSafetyCommand(input: string): SafetyCommand {
  const match = /^\/safety(?:\s+(.*))?$/i.exec(input.trim())
  if (!match) return { kind: 'none' }
  const arg = (match[1] ?? '').trim().toLowerCase()
  if (!arg) return { kind: 'status' }
  if (['on', 'sensitive', 'default', 'normal'].includes(arg)) return { kind: 'set', mode: 'sensitive' }
  if (['every', 'all', 'strict', 'always'].includes(arg)) return { kind: 'set', mode: 'every' }
  if (['off', 'none', 'never'].includes(arg)) return { kind: 'set', mode: 'off' }
  return { kind: 'bad', raw: arg }
}

/** A few words for the overlay banner, which has room for no more. */
export function safetyBadge(mode: ApprovalMode): string {
  switch (mode) {
    case 'sensitive':
      return 'Safety on'
    case 'every':
      return 'Safety: strict'
    case 'off':
      return 'Safety OFF'
  }
}

export function describeSafety(mode: ApprovalMode): string {
  switch (mode) {
    case 'sensitive':
      return 'Safety: asks before anything that sends, posts, pays, deletes, installs or opens system tools.'
    case 'every':
      return 'Safety: strict — asks before every single action.'
    case 'off':
      return 'Safety: OFF — the agent acts without asking. Turn it back on with "/safety on".'
  }
}
