/**
 * Screen memory - the pure half.
 *
 * Argus can keep a short, rolling record of what has been on screen, so a
 * question can be about something that is already gone: the dialog you
 * dismissed, the price on the tab you closed, the last ten minutes of work you
 * now have to write a standup note about.
 *
 * Everything here is deliberately free of Electron. The capture loop lives in
 * `main/screenMemory.ts`; what is worth keeping, what is worth sending, and
 * what a question is actually asking for are decided here, where they can be
 * tested.
 */

/**
 * One remembered moment.
 *
 * `at` is when the screen first looked like this and `until` is the last time
 * it still did - a frame that nothing changed for two minutes is one entry
 * spanning two minutes, not twenty-four identical ones. The image is a JPEG
 * held in memory and never written anywhere.
 */
export interface MemoryFrame {
  jpeg: Uint8Array
  width: number
  height: number
  at: number
  until: number
}

export interface MemoryLimits {
  /** How far back to keep anything at all. */
  windowMs: number
  /** Hard ceiling on the buffer, so a busy screen cannot eat the machine. */
  maxBytes: number
  maxFrames: number
}

/** Retention offered, in minutes. */
export const DEFAULT_MINUTES = 10
export const MIN_MINUTES = 1
export const MAX_MINUTES = 60

/**
 * How often the screen is sampled while memory is on.
 *
 * Five seconds is the compromise: fast enough that a dialog you dismissed
 * almost certainly landed in at least one frame, slow enough that the grab
 * itself is invisible. Anything that survives less than five seconds was never
 * something you had a chance to read either.
 */
export const CAPTURE_INTERVAL_MS = 5_000

/** Ceiling on the whole buffer. Roughly 60-90 minutes of an average screen. */
export const MAX_BYTES = 96 * 1024 * 1024
export const MAX_STORED_FRAMES = 720

/**
 * Frames sent with one question.
 *
 * Each is about 1,500 tokens, and the free tier counts tokens as well as
 * requests. Eight spread across the window has been enough to find a thing
 * that was on screen; more mostly buys duplicates of the same moment.
 */
export const MAX_SENT_FRAMES = 8

/**
 * Below this much average change, two frames are the same moment.
 *
 * A blinking cursor, a clock digit and a scrolling progress bar all move
 * without the screen meaning anything different. Set too low, the buffer fills
 * with a hundred copies of an idle desktop and the useful minute gets trimmed
 * away to make room for them.
 *
 * Measured rather than guessed. Sampling back-to-back grabs of a real desktop
 * gives two clearly separated groups: a quiet screen lands between 0.001 and
 * 0.008, while anything that actually changed - a terminal printing, a window
 * opening - lands above 0.049. This sits in the empty gap between them.
 */
export const SAME_FRAME_DELTA = 0.02

export function minutesToMs(minutes: number): number {
  return minutes * 60_000
}

/**
 * Mean per-channel difference between two same-sized RGBA thumbnails, 0 to 1.
 *
 * Compares every fourth pixel and ignores alpha, which is constant in a screen
 * grab. Different sizes count as completely different rather than throwing -
 * that happens when the display changes, which genuinely is a new moment.
 */
export function frameDelta(a: Uint8Array, b: Uint8Array): number {
  if (a.length === 0 || a.length !== b.length) return 1

  let total = 0
  let samples = 0
  for (let index = 0; index + 2 < a.length; index += 16) {
    total += Math.abs(a[index]! - b[index]!)
    total += Math.abs(a[index + 1]! - b[index + 1]!)
    total += Math.abs(a[index + 2]! - b[index + 2]!)
    samples += 3
  }

  return samples === 0 ? 1 : total / (samples * 255)
}

/**
 * Drops what has aged out or no longer fits.
 *
 * Oldest first, and never the newest frame even if that one alone is over the
 * byte cap: an empty buffer answers nothing, while a slightly oversized one
 * costs a few megabytes for one tick.
 */
export function trimFrames(
  frames: MemoryFrame[],
  limits: MemoryLimits,
  now: number
): MemoryFrame[] {
  const cutoff = now - limits.windowMs
  let kept = frames.filter((frame) => frame.until >= cutoff)

  if (kept.length > limits.maxFrames) kept = kept.slice(kept.length - limits.maxFrames)

  let bytes = kept.reduce((sum, frame) => sum + frame.jpeg.byteLength, 0)
  let first = 0
  while (bytes > limits.maxBytes && first < kept.length - 1) {
    bytes -= kept[first]!.jpeg.byteLength
    first++
  }

  return first === 0 ? kept : kept.slice(first)
}

/**
 * Chooses which frames to send with a question.
 *
 * Spread by position rather than by clock, because the buffer is already
 * de-duplicated: ten entries in one minute mean that minute is where the screen
 * kept changing, which is where the answer is likely to be. Both ends are
 * always included - the oldest sets the scene and the newest is nearly now.
 */
export function selectFrames(
  frames: MemoryFrame[],
  options: { now: number; windowMs: number; max?: number }
): MemoryFrame[] {
  const max = options.max ?? MAX_SENT_FRAMES
  const cutoff = options.now - options.windowMs
  const inWindow = frames.filter((frame) => frame.until >= cutoff)

  if (inWindow.length <= max) return inWindow
  if (max <= 1) return inWindow.slice(-1)

  const last = inWindow.length - 1
  const picked: MemoryFrame[] = []
  for (let step = 0; step < max; step++) {
    const frame = inWindow[Math.round((step * last) / (max - 1))]!
    if (picked[picked.length - 1] !== frame) picked.push(frame)
  }
  return picked
}

/** "just now" / "40s ago" / "7m ago" / "1h 5m ago". */
export function formatAge(ms: number): string {
  if (ms < 10_000) return 'just now'
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`

  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h ago` : `${hours}h ${rest}m ago`
}

/** The caption sent with each frame, so the model can date what it sees. */
export function frameLabel(frame: MemoryFrame, now: number): string {
  const start = formatAge(now - frame.until)
  // A frame that stood unchanged for a while covers a span, not an instant.
  if (frame.until - frame.at < CAPTURE_INTERVAL_MS * 2) return `[screen ${start}]`
  return `[screen from ${formatAge(now - frame.at)} until ${start}]`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface MemoryStatus {
  recording: boolean
  frames: number
  bytes: number
  /** When the oldest kept frame begins, or null when nothing is held. */
  oldestAt: number | null
  windowMs: number
}

/** The line shown by "/memory", and the one the tray tooltip shortens. */
export function describeMemory(status: MemoryStatus, now: number): string {
  const minutes = Math.round(status.windowMs / 60_000)

  if (!status.recording) {
    return [
      'Screen memory is off. Nothing about your screen is being kept.',
      '',
      `/memory on            remember the last ${minutes} minutes`,
      '/memory on 30         ...or a different number of minutes',
      '/recall <question>    ask about something already gone'
    ].join('\n')
  }

  const span =
    status.oldestAt === null ? 'nothing yet' : `back to ${formatAge(now - status.oldestAt)}`

  return [
    `Screen memory is on — keeping the last ${minutes} minutes.`,
    `${status.frames} moment${status.frames === 1 ? '' : 's'} held, ${span} (${formatBytes(status.bytes)} of RAM).`,
    'Held in memory only: never written to disk, never sent anywhere until you ask a question.',
    '',
    '/recall <question>    ask about something already gone',
    '/memory purge         forget everything, now',
    '/memory off           stop recording (and forget everything)'
  ].join('\n')
}

/** Short form for the tray tooltip and the bar's recording pill. */
export function shortStatus(status: MemoryStatus): string {
  if (!status.recording) return 'screen memory off'
  return `remembering the last ${Math.round(status.windowMs / 60_000)} min`
}

const UNIT_MS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000
}

const WORD_COUNTS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  ten: 10,
  couple: 2,
  'couple of': 2,
  few: 3
}

const SPAN =
  /\b(?:in |over |during |within |from )?(?:the )?(?:last |past )?(\d+|a|an|one|two|three|four|five|ten|couple of|couple|few)[\s-]*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i

/**
 * How far back a question is asking, in ms, or null when it does not say.
 *
 * "what was that error 2 minutes ago", "in the last 5 min", "a couple of hours
 * ago". A question with no time in it gets the whole retained window, which is
 * the only honest default: everything kept is everything that can be searched.
 */
export function lookbackMs(question: string): number | null {
  if (/\bjust now\b/i.test(question)) return 60_000
  if (/\b(?:a )?moments? ago\b/i.test(question)) return 120_000

  const span = SPAN.exec(question)
  if (!span) return null

  const rawCount = span[1]!.toLowerCase()
  const count = WORD_COUNTS[rawCount] ?? Number.parseInt(rawCount, 10)
  const unit = UNIT_MS[span[2]!.toLowerCase()]
  if (!unit || !Number.isFinite(count) || count <= 0) return null

  // A span is asked about as a point ("2 minutes ago") as often as a range
  // ("in the last 2 minutes"), and both want that whole stretch searched. Some
  // slack on top, because people round.
  return count * unit * 1.5
}

/** Nothing can be recalled from before recording started. */
export function clampWindow(requested: number | null, retentionMs: number): number {
  if (requested === null) return retentionMs
  return Math.min(Math.max(requested, 30_000), retentionMs)
}

/** Time words that only make sense about the past. */
const PAST_TIME =
  /\b(?:ago|earlier|just now|a moment|previously|before (?:i|you|it|that|the|closing|clicking)|last (?:few |couple (?:of )?)?(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)|past (?:few |couple (?:of )?)?(?:seconds?|secs?|minutes?|mins?|hours?|hrs?))\b/i

/**
 * Asking about your own recent activity, or about something that has gone.
 *
 * Kept narrow on purpose. "what did the author mean" is a question about the
 * screen in front of you and must stay in Talk Mode; routing it through the
 * timeline would spend several times the tokens to answer the same thing.
 */
const PAST_FIRST_PERSON =
  /\b(?:what (?:did|was) i\b|what (?:have|had|has) i been\b|what was on\b|what (?:was|did) that\b|where did i (?:see|read|find)\b|remind me what\b|(?:do|can) you remember\b|what (?:was|were) the .* (?:before|that (?:disappeared|vanished|closed))\b)/i

/**
 * Whether a question is about the past rather than about the screen right now.
 *
 * Only consulted while memory is recording. A false positive costs tokens; a
 * false negative costs nothing but typing "/recall", so this errs towards
 * leaving questions alone.
 */
export function looksLikeRecall(question: string): boolean {
  return PAST_TIME.test(question) || PAST_FIRST_PERSON.test(question)
}

export type MemoryCommand =
  | { kind: 'none' }
  | { kind: 'status' }
  | { kind: 'on'; minutes: number | null; raw: string }
  | { kind: 'off' }
  | { kind: 'purge' }
  | { kind: 'ask'; question: string }
  | { kind: 'unknown'; raw: string }

const SEP = '[\\s=:]+'
const STATUS = /^\/memory\s*$/i
const OFF = new RegExp(`^/memory${SEP}(?:off|stop|disable|no)\\s*$`, 'i')
const PURGE = new RegExp(`^/memory${SEP}(?:purge|forget|clear|wipe|delete)\\s*$`, 'i')
const ON = new RegExp(`^/memory${SEP}(?:on|start|enable|record|yes)(?:${SEP}(.+?))?\\s*$`, 'i')
const BARE_MINUTES = new RegExp(`^/memory${SEP}(\\d+\\s*[a-z]*)\\s*$`, 'i')
const OTHER = new RegExp(`^/memory${SEP}(.+?)\\s*$`, 'i')
const ASK = new RegExp(`^/recall(?:${SEP}(.*?))?\\s*$`, 'i')

/**
 * Reads the memory commands.
 *
 * The specific ones are matched before the general ones, for the same reason
 * "/keys" has to be read before "/key": "/memory off" parsed as "/memory" with
 * an argument would report the status of a recorder it was asked to stop.
 */
export function parseMemoryCommand(input: string): MemoryCommand {
  const text = input.trim()

  if (STATUS.test(text)) return { kind: 'status' }
  if (OFF.test(text)) return { kind: 'off' }
  if (PURGE.test(text)) return { kind: 'purge' }

  const on = ON.exec(text)
  if (on) {
    const raw = (on[1] ?? '').trim()
    return { kind: 'on', minutes: raw ? parseMinutes(raw) : null, raw }
  }

  const bare = BARE_MINUTES.exec(text)
  if (bare) {
    const raw = bare[1]!.trim()
    return { kind: 'on', minutes: parseMinutes(raw), raw }
  }

  const ask = ASK.exec(text)
  if (ask) return { kind: 'ask', question: (ask[1] ?? '').trim() }

  const other = OTHER.exec(text)
  if (other) return { kind: 'unknown', raw: other[1]!.trim() }

  return { kind: 'none' }
}

/** "20", "20m", "20 minutes", "1 hour" - clamped to what is offered. */
export function parseMinutes(raw: string): number | null {
  const match = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/i.exec(raw.trim())
  if (!match) return null

  const count = Number.parseInt(match[1]!, 10)
  if (!Number.isFinite(count) || count <= 0) return null

  const unit = (match[2] ?? 'm').toLowerCase()
  const minutes = unit.startsWith('h') ? count * 60 : count
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes))
}

/**
 * True for a "/recall" that actually carries a question.
 *
 * The bar routes slash commands to its status line and questions to the
 * transcript, and this is the one command whose reply is an answer: several
 * sentences, streamed, worth keeping above the input where it can be read and
 * followed up. Every other "/memory ..." is a report and belongs in the status
 * line with the rest of them.
 */
export function isRecallQuestion(text: string): boolean {
  const command = parseMemoryCommand(text)
  return command.kind === 'ask' && command.question.length > 0
}
