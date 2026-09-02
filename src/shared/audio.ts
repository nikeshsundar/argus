/**
 * Turning microphone samples into something a model will accept.
 *
 * MediaRecorder would be less code, but in Chromium it produces WebM/Opus and
 * Gemini's audio input does not list WebM among the containers it takes. Raw
 * PCM captured through Web Audio and wrapped in a WAV header avoids guessing:
 * WAV is supported, and the encoding is twenty lines that can be tested.
 */

/**
 * 16 kHz mono, which is the standard for speech recognition.
 *
 * Telephone speech is intelligible at 8 kHz; 16 kHz keeps the consonants that
 * distinguish similar words. Above that adds payload without adding accuracy,
 * and the microphone's native rate is usually 48 kHz - three times the bytes
 * for nothing.
 */
export const TARGET_SAMPLE_RATE = 16_000

/** Anything shorter than this is a mis-press, not an utterance. */
export const MIN_UTTERANCE_MS = 350

/**
 * Drops a signal to the target rate by averaging each source window.
 *
 * Averaging rather than picking one sample per window: taking every Nth sample
 * aliases high frequencies down into the speech band, which sounds like a
 * metallic rasp and costs accuracy.
 */
export function downsample(input: Float32Array, fromRate: number, toRate = TARGET_SAMPLE_RATE) {
  if (fromRate <= toRate) return input

  const ratio = fromRate / toRate
  const output = new Float32Array(Math.floor(input.length / ratio))

  for (let index = 0; index < output.length; index++) {
    const start = Math.floor(index * ratio)
    const end = Math.min(input.length, Math.floor((index + 1) * ratio))
    let total = 0
    for (let cursor = start; cursor < end; cursor++) total += input[cursor] ?? 0
    output[index] = end > start ? total / (end - start) : 0
  }

  return output
}

/** Wraps 16-bit PCM in the 44-byte RIFF header that makes it a .wav file. */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Uint8Array {
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(bytes)

  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header length
  view.setUint16(20, 1, true) // format: uncompressed PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per sample frame
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let index = 0; index < samples.length; index++) {
    // Clamp before scaling: a sample above 1.0 would wrap to a loud click.
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }

  return new Uint8Array(bytes)
}

/** Joins the chunks the audio callback collected into one signal. */
export function concatChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

/**
 * Loudest sample in the buffer, 0-1. Drives the level meter while recording,
 * so a dead microphone is visible before the user finishes speaking into it.
 */
export function peakLevel(samples: Float32Array): number {
  let peak = 0
  for (const sample of samples) {
    const magnitude = Math.abs(sample)
    if (magnitude > peak) peak = magnitude
  }
  return Math.min(1, peak)
}
