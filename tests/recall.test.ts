import { describe, expect, it } from 'vitest'
import {
  clampWindow,
  describeMemory,
  formatAge,
  formatBytes,
  frameDelta,
  frameLabel,
  isRecallQuestion,
  lookbackMs,
  looksLikeRecall,
  MAX_MINUTES,
  MIN_MINUTES,
  parseMemoryCommand,
  parseMinutes,
  selectFrames,
  trimFrames,
  type MemoryFrame
} from '../src/shared/recall'

const NOW = 1_700_000_000_000
const minute = 60_000

const frame = (agoMs: number, bytes = 1000, spanMs = 0): MemoryFrame => ({
  jpeg: new Uint8Array(bytes),
  width: 1280,
  height: 720,
  at: NOW - agoMs - spanMs,
  until: NOW - agoMs
})

describe('frameDelta', () => {
  it('is zero for an identical screen, which is most ticks', () => {
    const bytes = new Uint8Array(2304).fill(120)
    expect(frameDelta(bytes, bytes.slice())).toBe(0)
  })

  it('is large when the screen actually changed', () => {
    const dark = new Uint8Array(2304).fill(10)
    const bright = new Uint8Array(2304).fill(240)
    expect(frameDelta(dark, bright)).toBeGreaterThan(0.5)
  })

  it('treats a size change as completely different, not as an error', () => {
    // Happens when the display changes - which genuinely is a new moment.
    expect(frameDelta(new Uint8Array(16), new Uint8Array(32))).toBe(1)
    expect(frameDelta(new Uint8Array(0), new Uint8Array(0))).toBe(1)
  })
})

describe('trimFrames', () => {
  const limits = { windowMs: 10 * minute, maxBytes: 5000, maxFrames: 10 }

  it('drops what has aged out of the window', () => {
    const kept = trimFrames([frame(20 * minute), frame(minute)], limits, NOW)
    expect(kept).toHaveLength(1)
  })

  it('keeps a frame whose span reaches into the window', () => {
    // One entry can cover several minutes of an unchanged screen; it is still
    // the picture of what was there a moment ago.
    const old = frame(9 * minute, 1000, 20 * minute)
    expect(trimFrames([old], limits, NOW)).toHaveLength(1)
  })

  it('drops the oldest first when the byte cap is hit', () => {
    const frames = [frame(4 * minute, 2000), frame(3 * minute, 2000), frame(minute, 2000)]
    const kept = trimFrames(frames, limits, NOW)
    expect(kept).toHaveLength(2)
    expect(kept[0]).toBe(frames[1])
  })

  it('obeys the frame count as well as the byte cap', () => {
    const frames = Array.from({ length: 14 }, (_, index) => frame((14 - index) * 1000, 10))
    expect(trimFrames(frames, limits, NOW)).toHaveLength(10)
  })

  it('never empties itself over one oversized frame', () => {
    // An empty buffer answers nothing. Being a few MB over for one tick is the
    // cheaper of the two mistakes.
    const huge = frame(1000, 999_999)
    expect(trimFrames([huge], limits, NOW)).toEqual([huge])
  })
})

describe('selectFrames', () => {
  const frames = Array.from({ length: 40 }, (_, index) => frame((40 - index) * 10_000))

  it('sends everything when there is little enough', () => {
    const few = frames.slice(-3)
    expect(selectFrames(few, { now: NOW, windowMs: 10 * minute })).toEqual(few)
  })

  it('caps how many go with one question', () => {
    expect(selectFrames(frames, { now: NOW, windowMs: 60 * minute, max: 8 })).toHaveLength(8)
  })

  it('always includes both ends of the window', () => {
    const picked = selectFrames(frames, { now: NOW, windowMs: 60 * minute, max: 8 })
    expect(picked[0]).toBe(frames[0])
    expect(picked[picked.length - 1]).toBe(frames[frames.length - 1])
  })

  it('ignores anything older than the question asked about', () => {
    const picked = selectFrames(frames, { now: NOW, windowMs: 60_000 })
    expect(picked.every((one) => one.until >= NOW - 60_000)).toBe(true)
  })

  it('returns nothing when the buffer is empty, rather than inventing a frame', () => {
    expect(selectFrames([], { now: NOW, windowMs: minute })).toEqual([])
  })
})

describe('formatAge', () => {
  it('reads the way someone would say it', () => {
    expect(formatAge(2_000)).toBe('just now')
    expect(formatAge(42_000)).toBe('42s ago')
    expect(formatAge(3 * minute)).toBe('3m ago')
    expect(formatAge(65 * minute)).toBe('1h 5m ago')
    expect(formatAge(120 * minute)).toBe('2h ago')
  })

  it('never says zero seconds', () => {
    expect(formatAge(59_900)).toBe('59s ago')
    expect(formatAge(61_000)).toBe('1m ago')
  })
})

describe('frameLabel', () => {
  it('dates an instant', () => {
    expect(frameLabel(frame(3 * minute), NOW)).toBe('[screen 3m ago]')
  })

  it('gives a span for a screen that sat unchanged', () => {
    expect(frameLabel(frame(minute, 10, 5 * minute), NOW)).toBe(
      '[screen from 6m ago until 1m ago]'
    )
  })
})

describe('formatBytes', () => {
  it('stays readable at both ends', () => {
    expect(formatBytes(4096)).toBe('4 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('lookbackMs', () => {
  it('reads a number and a unit', () => {
    expect(lookbackMs('what was that error 2 minutes ago')).toBe(2 * minute * 1.5)
    expect(lookbackMs('in the last 5 min, what did i open')).toBe(5 * minute * 1.5)
    expect(lookbackMs('what was i doing an hour ago')).toBe(3_600_000 * 1.5)
  })

  it('reads the vague ones people actually type', () => {
    expect(lookbackMs('what did that popup say just now')).toBe(60_000)
    expect(lookbackMs('what was on screen a moment ago')).toBe(120_000)
    expect(lookbackMs('what was that error a couple of minutes ago')).toBe(2 * minute * 1.5)
  })

  it('says nothing when the question gives no time', () => {
    expect(lookbackMs('what was that error code')).toBeNull()
    expect(lookbackMs('summarise this page')).toBeNull()
  })

  it('is not fooled by a bare letter inside a word', () => {
    expect(lookbackMs('what did the sms say')).toBeNull()
  })
})

describe('clampWindow', () => {
  it('falls back to everything retained when the question gives no time', () => {
    expect(clampWindow(null, 10 * minute)).toBe(10 * minute)
  })

  it('cannot search further back than was ever kept', () => {
    expect(clampWindow(60 * minute, 10 * minute)).toBe(10 * minute)
  })

  it('keeps a floor, so a "just now" still spans more than one frame', () => {
    expect(clampWindow(1_000, 10 * minute)).toBe(30_000)
  })
})

describe('looksLikeRecall', () => {
  it('catches a question about something already gone', () => {
    for (const question of [
      'what was that error 2 minutes ago',
      'what did i just close',
      'what have i been doing for the last 10 minutes',
      'what was on my screen earlier',
      'what was that popup',
      'where did i see that phone number',
      'what was the price before i closed the tab'
    ]) {
      expect(looksLikeRecall(question), question).toBe(true)
    }
  })

  it('leaves ordinary questions about the live screen alone', () => {
    // A false positive costs several times the tokens to answer the same
    // thing, so anything ambiguous stays in Talk Mode.
    for (const question of [
      'what did the author mean by this',
      'what is this error',
      'summarise this page',
      'explain what was written here', // past tense, but about what is visible
      'translate this'
    ]) {
      expect(looksLikeRecall(question), question).toBe(false)
    }
  })
})

describe('parseMemoryCommand', () => {
  it('reads a bare command as asking for the status', () => {
    expect(parseMemoryCommand('/memory')).toEqual({ kind: 'status' })
  })

  it('does not read "/memory off" as a status request', () => {
    // The "/key" versus "/keys" lesson: a specific command swallowed by a
    // general one reports success while doing nothing.
    expect(parseMemoryCommand('/memory off')).toEqual({ kind: 'off' })
    expect(parseMemoryCommand('/memory stop')).toEqual({ kind: 'off' })
  })

  it('reads every wording of forget', () => {
    for (const verb of ['purge', 'forget', 'clear', 'wipe', 'delete']) {
      expect(parseMemoryCommand(`/memory ${verb}`)).toEqual({ kind: 'purge' })
    }
  })

  it('turns recording on, with or without a length', () => {
    expect(parseMemoryCommand('/memory on')).toEqual({ kind: 'on', minutes: null, raw: '' })
    expect(parseMemoryCommand('/memory on 30')).toEqual({ kind: 'on', minutes: 30, raw: '30' })
    expect(parseMemoryCommand('/memory on 1 hour')).toEqual({
      kind: 'on',
      minutes: 60,
      raw: '1 hour'
    })
  })

  it('treats a bare number as turning it on for that long', () => {
    expect(parseMemoryCommand('/memory 20')).toEqual({ kind: 'on', minutes: 20, raw: '20' })
    expect(parseMemoryCommand('/memory 20m')).toEqual({ kind: 'on', minutes: 20, raw: '20m' })
  })

  it('reports an unparseable length instead of silently picking one', () => {
    expect(parseMemoryCommand('/memory on ages')).toEqual({
      kind: 'on',
      minutes: null,
      raw: 'ages'
    })
  })

  it('claims a mistyped subcommand so it can be explained', () => {
    expect(parseMemoryCommand('/memory recrod')).toEqual({ kind: 'unknown', raw: 'recrod' })
  })

  it('reads a recall question', () => {
    expect(parseMemoryCommand('/recall what was that error')).toEqual({
      kind: 'ask',
      question: 'what was that error'
    })
  })

  it('claims a bare "/recall", so the error can say what is missing', () => {
    expect(parseMemoryCommand('/recall')).toEqual({ kind: 'ask', question: '' })
  })

  it('ignores anything that is not one of its commands', () => {
    for (const text of ['/keys', 'what was that error', '/memories', '/recalls x', '']) {
      expect(parseMemoryCommand(text), text).toEqual({ kind: 'none' })
    }
  })
})

describe('isRecallQuestion', () => {
  it('is true only for a "/recall" carrying a question', () => {
    // The bar sends commands to its status line and questions to the
    // transcript; a streamed multi-sentence answer belongs in the transcript.
    expect(isRecallQuestion('/recall what was that error')).toBe(true)
    expect(isRecallQuestion('/recall')).toBe(false)
    expect(isRecallQuestion('/memory on')).toBe(false)
    expect(isRecallQuestion('/keys')).toBe(false)
  })
})

describe('parseMinutes', () => {
  it('accepts the forms people type', () => {
    expect(parseMinutes('20')).toBe(20)
    expect(parseMinutes('20m')).toBe(20)
    expect(parseMinutes('20 minutes')).toBe(20)
    expect(parseMinutes('2h')).toBe(120 > MAX_MINUTES ? MAX_MINUTES : 120)
  })

  it('clamps to what is on offer rather than refusing', () => {
    expect(parseMinutes('9999')).toBe(MAX_MINUTES)
    expect(parseMinutes('0')).toBeNull()
    expect(parseMinutes('1')).toBe(MIN_MINUTES)
  })

  it('rejects what is not a length', () => {
    expect(parseMinutes('ages')).toBeNull()
    expect(parseMinutes('')).toBeNull()
  })
})

describe('describeMemory', () => {
  it('says plainly that nothing is kept when it is off', () => {
    const text = describeMemory(
      { recording: false, frames: 0, bytes: 0, oldestAt: null, windowMs: 10 * minute },
      NOW
    )
    expect(text).toContain('off')
    expect(text).toContain('Nothing about your screen is being kept')
  })

  it('says how much is held and how far back it goes', () => {
    const text = describeMemory(
      {
        recording: true,
        frames: 42,
        bytes: 8 * 1024 * 1024,
        oldestAt: NOW - 9 * minute,
        windowMs: 10 * minute
      },
      NOW
    )
    expect(text).toContain('42 moments held')
    expect(text).toContain('back to 9m ago')
    expect(text).toContain('never written to disk')
  })
})
