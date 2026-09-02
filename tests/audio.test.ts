import { describe, expect, it } from 'vitest'
import {
  concatChunks,
  downsample,
  encodeWav,
  hasWords,
  peakLevel,
  SILENCE_PEAK,
  TARGET_SAMPLE_RATE
} from '../src/shared/audio'

/** Reads a little-endian ASCII tag out of the header. */
const tag = (wav: Uint8Array, at: number): string =>
  String.fromCharCode(...wav.slice(at, at + 4))

const u32 = (wav: Uint8Array, at: number): number =>
  new DataView(wav.buffer, wav.byteOffset).getUint32(at, true)

const u16 = (wav: Uint8Array, at: number): number =>
  new DataView(wav.buffer, wav.byteOffset).getUint16(at, true)

describe('encodeWav', () => {
  it('writes a header Gemini will recognise as a wav', () => {
    const wav = encodeWav(new Float32Array(100))
    expect(tag(wav, 0)).toBe('RIFF')
    expect(tag(wav, 8)).toBe('WAVE')
    expect(tag(wav, 12)).toBe('fmt ')
    expect(tag(wav, 36)).toBe('data')
  })

  it('declares uncompressed mono PCM at the target rate', () => {
    const wav = encodeWav(new Float32Array(10))
    expect(u16(wav, 20)).toBe(1) // PCM
    expect(u16(wav, 22)).toBe(1) // mono
    expect(u32(wav, 24)).toBe(TARGET_SAMPLE_RATE)
    expect(u16(wav, 34)).toBe(16) // bits per sample
  })

  it('gets the two length fields right, which is what a decoder trusts', () => {
    const wav = encodeWav(new Float32Array(64))
    expect(wav.length).toBe(44 + 64 * 2)
    expect(u32(wav, 4)).toBe(36 + 64 * 2) // RIFF chunk size
    expect(u32(wav, 40)).toBe(64 * 2) // data chunk size
  })

  it('clamps rather than wrapping, so a loud sample is not a click', () => {
    // Scaling 1.5 without clamping overflows int16 and wraps to a negative
    // value - audibly a sharp click, and exactly where speech peaks.
    const wav = encodeWav(new Float32Array([1.5, -1.5]))
    const view = new DataView(wav.buffer, wav.byteOffset)
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
  })

  it('round-trips a sample close to where it started', () => {
    const wav = encodeWav(new Float32Array([0.5]))
    const view = new DataView(wav.buffer, wav.byteOffset)
    expect(view.getInt16(44, true) / 32767).toBeCloseTo(0.5, 3)
  })
})

describe('downsample', () => {
  it('reduces 48k to 16k by a factor of three', () => {
    expect(downsample(new Float32Array(4800), 48_000).length).toBe(1600)
  })

  it('leaves a signal already at or below the target alone', () => {
    const already = new Float32Array(160)
    expect(downsample(already, 16_000)).toBe(already)
    expect(downsample(already, 8_000)).toBe(already)
  })

  it('averages the window instead of picking one sample', () => {
    // Taking every Nth sample aliases high frequencies into the speech band.
    // Averaging [0,1,2] gives 1; decimation would give 0.
    const input = new Float32Array([0, 1, 2, 3, 4, 5])
    const output = downsample(input, 48_000, 16_000)
    expect(output[0]).toBeCloseTo(1, 6)
    expect(output[1]).toBeCloseTo(4, 6)
  })

  it('preserves a constant signal exactly', () => {
    const flat = new Float32Array(300).fill(0.25)
    for (const sample of downsample(flat, 48_000)) expect(sample).toBeCloseTo(0.25, 6)
  })
})

describe('concatChunks', () => {
  it('joins the callback buffers in order', () => {
    const merged = concatChunks([new Float32Array([1, 2]), new Float32Array([3])])
    expect(Array.from(merged)).toEqual([1, 2, 3])
  })

  it('handles a recording that captured nothing', () => {
    expect(concatChunks([]).length).toBe(0)
  })
})

describe('peakLevel', () => {
  it('reports the loudest magnitude, sign ignored', () => {
    expect(peakLevel(new Float32Array([0.1, -0.8, 0.3]))).toBeCloseTo(0.8, 6)
  })

  it('is zero for silence, so a dead mic reads as dead', () => {
    expect(peakLevel(new Float32Array(64))).toBe(0)
  })

  it('never exceeds one, since it drives a transform', () => {
    expect(peakLevel(new Float32Array([4]))).toBe(1)
  })
})

describe('hasWords', () => {
  it('rejects what silence comes back as', () => {
    // The reported failure: a silent take was transcribed as "00" and then run
    // as an agent instruction.
    for (const text of ['00', '0', '...', '  ', '', '1 2 3', '-']) {
      expect(hasWords(text), JSON.stringify(text)).toBe(false)
    }
  })

  it('accepts anything with a real word in it', () => {
    for (const text of ['open instagram', 'go', 'hi there', 'search MrBeast']) {
      expect(hasWords(text), text).toBe(true)
    }
  })
})

describe('SILENCE_PEAK', () => {
  it('passes speech and rejects room tone', () => {
    const roomTone = new Float32Array(1000).map(() => (Math.random() - 0.5) * 0.01)
    const speech = new Float32Array(1000).map((_, i) => Math.sin(i / 4) * 0.4)
    expect(peakLevel(roomTone)).toBeLessThan(SILENCE_PEAK)
    expect(peakLevel(speech)).toBeGreaterThan(SILENCE_PEAK)
  })

  it('rejects a stream of exact zeros, which is a muted device', () => {
    expect(peakLevel(new Float32Array(1000))).toBeLessThan(SILENCE_PEAK)
  })
})
