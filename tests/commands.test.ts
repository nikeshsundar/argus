import { describe, expect, it } from 'vitest'
import { isBareApiKey, parseKeyCommand } from '../src/shared/commands'

const KEY_A = 'AQ.EXAMPLE0000000000000000000000000000000000000AAAA'
const KEY_B = 'AIzaSyEXAMPLE00000000000000000000000BBBB'

describe('/key — the singular', () => {
  it('adds one key', () => {
    expect(parseKeyCommand(`/key ${KEY_A}`)).toEqual({ kind: 'add', key: KEY_A })
  })

  it('tolerates the separators people type', () => {
    for (const text of [`/key ${KEY_A}`, `/key  ${KEY_A}`, `/key=${KEY_A}`, `/key: ${KEY_A}`]) {
      expect(parseKeyCommand(text), text).toEqual({ kind: 'add', key: KEY_A })
    }
  })

  it('survives surrounding whitespace from a paste', () => {
    expect(parseKeyCommand(`  /key ${KEY_A}  `)).toEqual({ kind: 'add', key: KEY_A })
  })

  it('is case-insensitive, like every other command', () => {
    expect(parseKeyCommand(`/KEY ${KEY_A}`)).toEqual({ kind: 'add', key: KEY_A })
  })
})

describe('/keys — the plural', () => {
  it('is not read as "/key" with an argument starting with s', () => {
    // The bug: the singular pattern is checked first and "/keys X" nearly
    // matches it, which would swallow the plural entirely.
    expect(parseKeyCommand(`/keys ${KEY_A}`)).toEqual({
      kind: 'load',
      keys: [KEY_A],
      ignored: 0
    })
  })

  it('lists when given nothing', () => {
    expect(parseKeyCommand('/keys')).toEqual({ kind: 'list' })
    expect(parseKeyCommand('  /keys  ')).toEqual({ kind: 'list' })
  })

  it('loads several, however they were separated', () => {
    for (const joiner of [' ', ', ', '\n', '; ']) {
      expect(parseKeyCommand(`/keys ${KEY_A}${joiner}${KEY_B}`), joiner).toEqual({
        kind: 'load',
        keys: [KEY_A, KEY_B],
        ignored: 0
      })
    }
  })

  it('drops duplicates, which would only fail twice', () => {
    expect(parseKeyCommand(`/keys ${KEY_A} ${KEY_A} ${KEY_B}`)).toEqual({
      kind: 'load',
      keys: [KEY_A, KEY_B],
      ignored: 0
    })
  })

  it('counts what it ignored rather than silently dropping it', () => {
    expect(parseKeyCommand(`/keys ${KEY_A} not-a-key also-junk`)).toEqual({
      kind: 'load',
      keys: [KEY_A],
      ignored: 2
    })
  })

  it('keeps clear and reset distinct from a bulk load', () => {
    expect(parseKeyCommand('/keys clear')).toEqual({ kind: 'clear' })
    expect(parseKeyCommand('/keys reset')).toEqual({ kind: 'reset' })
  })
})

describe('anything else', () => {
  it('is not a key command', () => {
    for (const text of ['/help', '/model gemini-3.5-flash-lite', 'open instagram', '']) {
      expect(parseKeyCommand(text), text).toEqual({ kind: 'none' })
    }
  })
})

describe('isBareApiKey', () => {
  it('catches a key pasted with no command', () => {
    // What actually happened: the key was sent to the model as a question and
    // written into the saved transcript.
    expect(isBareApiKey(KEY_A)).toBe(true)
    expect(isBareApiKey(`  ${KEY_B}  `)).toBe(true)
  })

  it('leaves real questions alone', () => {
    for (const text of ['what is on my screen', 'open instagram', 'AIza', 'teach me github']) {
      expect(isBareApiKey(text), text).toBe(false)
    }
  })

  it('ignores anything already carrying a command', () => {
    expect(isBareApiKey(`/key ${KEY_A}`)).toBe(false)
    expect(isBareApiKey(`/keys ${KEY_A}`)).toBe(false)
  })

  it('does not fire on a sentence that merely contains a key', () => {
    // Only a bare paste is unambiguous; a sentence might be a real question.
    expect(isBareApiKey(`is ${KEY_A} valid`)).toBe(false)
  })
})
