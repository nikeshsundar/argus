import { inferProviderFromKey } from './keys'

/**
 * Parsing for the two key commands, which are deliberately different things.
 *
 * "/key <k>" adds one key. "/keys ..." is the plural: with arguments it loads
 * several at once, and bare it lists them. They were two regexes sitting next
 * to each other in the command handler, where the singular could shadow the
 * plural and a near miss on either fell through to the model - taking the key
 * with it.
 */
export type KeyCommand =
  | { kind: 'add'; key: string }
  | { kind: 'load'; keys: string[]; ignored: number }
  | { kind: 'list' }
  | { kind: 'clear' }
  | { kind: 'reset' }
  | { kind: 'none' }

/** Separators people actually type between a command and its argument. */
const SEP = '[\\s=:]+'

const ADD = new RegExp(`^/key${SEP}(\\S+)\\s*$`, 'i')
const LIST = /^\/keys\s*$/i
const CLEAR = new RegExp(`^/keys${SEP}clear\\s*$`, 'i')
const RESET = new RegExp(`^/keys${SEP}reset\\s*$`, 'i')
const LOAD = new RegExp(`^/keys${SEP}(.+)$`, 'is')

export function parseKeyCommand(input: string): KeyCommand {
  const text = input.trim()

  // The plural is checked first: "/keys" would otherwise be read as "/key"
  // followed by an argument beginning with "s".
  if (LIST.test(text)) return { kind: 'list' }
  if (CLEAR.test(text)) return { kind: 'clear' }
  if (RESET.test(text)) return { kind: 'reset' }

  const load = LOAD.exec(text)
  if (load) {
    const parts = load[1]!
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    const recognised = parts.filter((entry) => looksLikeKey(entry))
    return {
      kind: 'load',
      keys: [...new Set(recognised)],
      ignored: parts.length - recognised.length
    }
  }

  const add = ADD.exec(text)
  if (add) return { kind: 'add', key: add[1]! }

  return { kind: 'none' }
}

/**
 * True for a key pasted with no command at all.
 *
 * Pasting the key on its own is the obvious thing to do, and it used to be
 * treated as a question about the screen - which sent the key to the model and
 * wrote it into the saved transcript on the way past.
 */
export function isBareApiKey(input: string): boolean {
  const text = input.trim()
  if (text.startsWith('/') || /\s/.test(text)) return false
  return looksLikeKey(text)
}

/**
 * Prefix AND plausible length.
 *
 * inferProviderFromKey matches on the prefix alone, which is right when routing
 * something the user already called a key. It is too loose for guessing: the
 * bare word "AIza" would otherwise be quietly swallowed as a credential
 * instead of being asked about the screen.
 */
const MIN_KEY_LENGTH = 20

function looksLikeKey(text: string): boolean {
  return text.length >= MIN_KEY_LENGTH && inferProviderFromKey(text) !== null
}
