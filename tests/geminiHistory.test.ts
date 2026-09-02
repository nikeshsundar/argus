import { describe, expect, it } from 'vitest'
import { dropStaleImages } from '../src/main/providers/geminiClient'

const image = (tag: string): unknown => ({
  inline_data: { mime_type: 'image/png', data: `pixels-${tag}` }
})

const hasImage = (turn: { parts: unknown[] }): boolean =>
  turn.parts.some((part) => part !== null && typeof part === 'object' && 'inline_data' in part)

describe('dropStaleImages', () => {
  it('keeps only the newest screenshot', () => {
    // Step 10 was re-sending ten screenshots. Only the current screen is used
    // to decide the next action; the rest is history the text already carries.
    const contents = [
      { role: 'user', parts: [image('1'), { text: 'Task: open github' }] },
      { role: 'model', parts: [{ functionCall: { name: 'launch_app', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: {} }, image('2')] },
      { role: 'model', parts: [{ functionCall: { name: 'click', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: {} }, image('3')] }
    ]

    dropStaleImages(contents)

    expect(contents.filter(hasImage)).toHaveLength(1)
    expect(hasImage(contents[4]!)).toBe(true)
  })

  it('leaves the text and tool history intact', () => {
    const contents = [
      { role: 'user', parts: [image('1'), { text: 'Task: open github' }] },
      { role: 'model', parts: [{ functionCall: { name: 'launch_app', args: { name: 'Edge' } } }] },
      { role: 'user', parts: [image('2')] }
    ]

    dropStaleImages(contents)

    // The task statement is the only record of what was asked.
    expect(contents[0]!.parts).toContainEqual({ text: 'Task: open github' })
    // The model's own turns are replayed verbatim for thoughtSignature reasons.
    expect(contents[1]!.parts).toEqual([
      { functionCall: { name: 'launch_app', args: { name: 'Edge' } } }
    ])
  })

  it('replaces a dropped image rather than deleting the slot', () => {
    const contents = [{ role: 'user', parts: [image('1')] }, { role: 'user', parts: [image('2')] }]
    dropStaleImages(contents)
    expect(contents[0]!.parts).toHaveLength(1)
    expect(contents[0]!.parts[0]).toHaveProperty('text')
  })

  it('is safe on the first turn, when there is nothing older', () => {
    const contents = [{ role: 'user', parts: [image('1'), { text: 'Task: x' }] }]
    dropStaleImages(contents)
    expect(hasImage(contents[0]!)).toBe(true)
  })

  it('is idempotent, since it runs before every single turn', () => {
    const contents = [
      { role: 'user', parts: [image('1')] },
      { role: 'user', parts: [image('2')] }
    ]
    dropStaleImages(contents)
    const afterFirst = JSON.stringify(contents)
    dropStaleImages(contents)
    expect(JSON.stringify(contents)).toBe(afterFirst)
  })

  it('copes with an empty history', () => {
    expect(() => dropStaleImages([])).not.toThrow()
  })
})
