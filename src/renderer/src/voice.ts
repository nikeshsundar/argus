import { concatChunks, downsample, encodeWav, peakLevel, TARGET_SAMPLE_RATE } from '../../shared/audio'

/**
 * Microphone capture for the bar.
 *
 * The stream is opened when recording starts and every track is stopped when it
 * ends - not held open and muted. On Windows that is the difference between the
 * microphone-in-use indicator being on only while you speak, and being on for
 * as long as Argus is running. For an app that promises it isn't watching you,
 * it had better not be listening either.
 */
export interface Capture {
  wav: Uint8Array
  /** Loudest sample in the whole take, 0-1. Near zero means nothing was heard. */
  peak: number
  durationMs: number
}

export interface Recorder {
  stop(): Promise<Capture | null>
  cancel(): void
}

/**
 * A failure the user can act on.
 *
 * The first version reported every failure as "no microphone available", which
 * sent someone hunting for a hardware fault when the real cause was a Content
 * Security Policy rejecting the worklet. An error that names the wrong cause is
 * worse than one that says nothing.
 */
export class MicrophoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MicrophoneError'
  }
}

/** Maps a DOMException from getUserMedia onto something worth reading. */
function describeMicFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
      return 'Microphone access was refused. Allow it in Windows Settings → Privacy → Microphone.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found. Plug one in, or pick one in Windows sound settings.'
    case 'NotReadableError':
      return 'The microphone is in use by another app.'
    default:
      return `Could not start recording: ${error instanceof Error ? error.message : String(error)}`
  }
}

export interface RecorderOptions {
  /** Called with 0-1 loudness so the UI can show the mic is actually hearing. */
  onLevel?: (level: number) => void
}

/**
 * Kept recording after the button is released.
 *
 * A release is a decision made while the last word is still being said, so
 * cutting the stream on the exact pointerup clips it. The tail is short enough
 * that nobody notices the delay and long enough to keep the word.
 */
const TAIL_MS = 350

/**
 * The capture runs in an AudioWorklet, on the audio thread.
 *
 * The obvious alternative, ScriptProcessorNode, runs its callback on the main
 * thread - the same thread rendering the bar, updating the status line and
 * animating the level meter. Under that load it silently drops buffers, and a
 * dropped buffer is a missing word. This was the actual cause of poor
 * transcription; the model was faithfully transcribing audio with holes in it.
 */
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = []
    this.held = 0
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      this.buffer.push(new Float32Array(channel))
      this.held += channel.length
      // Batched to roughly 128ms so the message port isn't woken 375 times a
      // second for 128-frame quanta.
      if (this.held >= 2048) {
        this.port.postMessage(this.buffer)
        this.buffer = []
        this.held = 0
      }
    }
    return true
  }
}
registerProcessor('argus-capture', Capture)
`

export async function startRecording(options: RecorderOptions = {}): Promise<Recorder> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
  } catch (error) {
    throw new MicrophoneError(describeMicFailure(error))
  }

  // Asking for the target rate up front lets Chromium resample with a proper
  // filter, which is better than the box average `downsample` falls back to.
  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))

  try {
    await context.audioWorklet.addModule(moduleUrl)
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    void context.close()
    throw new MicrophoneError(
      `The audio recorder could not start: ${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    URL.revokeObjectURL(moduleUrl)
  }

  const source = context.createMediaStreamSource(stream)
  const capture = new AudioWorkletNode(context, 'argus-capture')

  const chunks: Float32Array[] = []
  let latestLevel = 0
  let stopped = false

  capture.port.onmessage = (event: MessageEvent<Float32Array[]>) => {
    if (stopped) return
    for (const chunk of event.data) {
      chunks.push(chunk)
      const level = peakLevel(chunk)
      if (level > latestLevel) latestLevel = level
    }
  }

  source.connect(capture)

  // The meter is read on a frame, not on every audio message. Touching layout
  // from the audio path is what made the main thread the bottleneck before.
  let meter = 0
  const tick = (): void => {
    if (stopped) return
    options.onLevel?.(latestLevel)
    latestLevel *= 0.6 // decay, so the ring falls back between syllables
    meter = requestAnimationFrame(tick)
  }
  meter = requestAnimationFrame(tick)

  const teardown = (): void => {
    stopped = true
    cancelAnimationFrame(meter)
    capture.port.onmessage = null
    capture.disconnect()
    source.disconnect()
    for (const track of stream.getTracks()) track.stop()
    void context.close()
  }

  return {
    async stop(): Promise<Capture | null> {
      // Let the last word arrive before tearing the stream down.
      await new Promise((resolve) => setTimeout(resolve, TAIL_MS))

      const rate = context.sampleRate
      teardown()
      if (chunks.length === 0) return null

      const merged = concatChunks(chunks)
      // `sampleRate` in the constructor is a request, not a guarantee.
      const samples = rate === TARGET_SAMPLE_RATE ? merged : downsample(merged, rate)
      return {
        wav: encodeWav(samples),
        peak: peakLevel(samples),
        durationMs: Math.round((samples.length / TARGET_SAMPLE_RATE) * 1000)
      }
    },
    cancel: teardown
  }
}
