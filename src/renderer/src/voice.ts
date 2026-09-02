import { concatChunks, downsample, encodeWav, peakLevel } from '../../shared/audio'

/**
 * Microphone capture for the bar.
 *
 * The stream is opened when recording starts and every track is stopped when it
 * ends - not held open and muted. On Windows that is the difference between the
 * microphone-in-use indicator being on only while you speak, and being on for
 * as long as Argus is running. For an app that promises it isn't watching you,
 * it had better not be listening either.
 */
export interface Recorder {
  stop(): Promise<Uint8Array | null>
  cancel(): void
}

export interface RecorderOptions {
  /** Called with 0-1 loudness so the UI can show the mic is actually hearing. */
  onLevel?: (level: number) => void
}

/** Buffer size in frames: ~85ms at 48kHz, which is a smooth meter without churn. */
const FRAME_SIZE = 4096

export async function startRecording(options: RecorderOptions = {}): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  })

  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  // ScriptProcessorNode is deprecated in favour of AudioWorklet, which needs a
  // separately loaded module file. For a few seconds of speech the simpler node
  // is the better trade, and it behaves identically here.
  const processor = context.createScriptProcessor(FRAME_SIZE, 1, 1)

  const chunks: Float32Array[] = []
  let stopped = false

  processor.onaudioprocess = (event) => {
    if (stopped) return
    const input = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(input))
    options.onLevel?.(peakLevel(input))
  }

  source.connect(processor)
  // A ScriptProcessor only runs while connected to a destination. Routing it to
  // a silent gain node keeps it processing without playing the microphone back
  // through the speakers.
  const mute = context.createGain()
  mute.gain.value = 0
  processor.connect(mute)
  mute.connect(context.destination)

  const teardown = (): void => {
    stopped = true
    processor.onaudioprocess = null
    processor.disconnect()
    mute.disconnect()
    source.disconnect()
    for (const track of stream.getTracks()) track.stop()
    void context.close()
  }

  return {
    async stop(): Promise<Uint8Array | null> {
      const rate = context.sampleRate
      teardown()
      if (chunks.length === 0) return null
      return encodeWav(downsample(concatChunks(chunks), rate))
    },
    cancel: teardown
  }
}
