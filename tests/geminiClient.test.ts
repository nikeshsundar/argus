import { describe, expect, it } from 'vitest'
import { collectStream, pickReplacement, thinkingConfigFor } from '../src/main/providers/geminiClient'

describe('thinkingConfigFor', () => {
  it('uses a thinking budget on the 2.5 family, which rejects thinkingLevel', () => {
    expect(thinkingConfigFor('gemini-2.5-flash', 'low')).toEqual({ thinkingBudget: 0 })
    expect(thinkingConfigFor('gemini-2.5-flash-lite', 'low')).toEqual({ thinkingBudget: 0 })
    expect(thinkingConfigFor('gemini-2.5-flash', 'high')).toEqual({ thinkingBudget: -1 })
  })

  it('keeps 2.5 Pro above its minimum budget, since it cannot stop thinking', () => {
    expect(thinkingConfigFor('gemini-2.5-pro', 'low')).toEqual({ thinkingBudget: 128 })
  })

  it('uses thinkingLevel for everything newer', () => {
    expect(thinkingConfigFor('gemini-3-flash-preview', 'low')).toEqual({ thinkingLevel: 'low' })
    expect(thinkingConfigFor('gemini-flash-latest', 'high')).toEqual({ thinkingLevel: 'high' })
  })
})

describe('pickReplacement', () => {
  it('skips variants that cannot read a screenshot', () => {
    const listed = [
      'gemini-2.5-flash-preview-tts',
      'gemini-2.0-flash-preview-image-generation',
      'gemini-embedding-001',
      'gemma-3-1b-it',
      'gemini-2.0-flash'
    ]
    expect(pickReplacement(listed, [])).toBe('gemini-2.0-flash')
  })

  it('prefers a stable flash model over a preview one', () => {
    expect(pickReplacement(['gemini-3-flash-preview', 'gemini-2.0-flash'], [])).toBe(
      'gemini-2.0-flash'
    )
  })

  it('never offers a model that was already tried', () => {
    expect(pickReplacement(['gemini-2.5-flash'], ['gemini-2.5-flash'])).toBeNull()
  })
})

describe('collectStream', () => {
  const sse = (...events: unknown[]): ReadableStream<Uint8Array> => {
    const text = events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join('')
    const bytes = new TextEncoder().encode(text)
    return new ReadableStream({
      start(controller) {
        // Split mid-event, as the network does.
        controller.enqueue(bytes.slice(0, 17))
        controller.enqueue(bytes.slice(17))
        controller.close()
      }
    })
  }

  it('rebuilds one response from the chunks, keeping function calls and signatures intact', async () => {
    const payload = await collectStream(
      sse(
        { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'lo' }] } }] },
        {
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: 'click', args: { x: 1 } }, thoughtSignature: 'sig' }]
              },
              finishReason: 'STOP'
            }
          ]
        }
      )
    )
    expect(payload.candidates?.[0]?.content?.parts).toEqual([
      { text: 'Hello' },
      { functionCall: { name: 'click', args: { x: 1 } }, thoughtSignature: 'sig' }
    ])
    expect(payload.candidates?.[0]?.finishReason).toBe('STOP')
  })

  it('surfaces an error sent mid-stream', async () => {
    await expect(collectStream(sse({ error: { message: 'overloaded' } }))).rejects.toThrow(/overloaded/)
  })
})
