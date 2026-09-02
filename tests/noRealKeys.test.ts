import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Fails if a real-looking API key is committed anywhere in the repo.
 *
 * A real key reached a test file once, as a fixture copied out of a live
 * settings file rather than invented. GitHub's scanner caught it after it was
 * already public, which is the wrong end of the process to find it.
 *
 * The rule is deliberately crude: any key-shaped string must contain EXAMPLE.
 * That is trivially satisfiable by an honest fixture and impossible to satisfy
 * by accident with a real credential.
 */
const KEY_SHAPES = [
  /AIza[A-Za-z0-9_-]{30,}/g, // Google AI Studio
  /AQ\.[A-Za-z0-9_-]{30,}/g, // Google, newer format
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic
  /sk-proj-[A-Za-z0-9_-]{20,}/g // OpenAI
]

/** Files git actually tracks. Anything untracked cannot leak by being pushed. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !/\.(png|ico|jpg|jpeg|gif|webp|woff2?|zip|exe)$/i.test(path))
}

describe('no real API keys in the repository', () => {
  it('every key-shaped string is marked EXAMPLE', () => {
    const offenders: string[] = []

    for (const path of trackedFiles()) {
      let content: string
      try {
        content = readFileSync(path, 'utf8')
      } catch {
        continue // unreadable or binary despite the extension filter
      }

      for (const shape of KEY_SHAPES) {
        for (const match of content.match(shape) ?? []) {
          if (!match.includes('EXAMPLE')) offenders.push(`${path}: ${match.slice(0, 12)}…`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('recognises a planted key, so the check cannot silently pass', () => {
    // Guards the guard: a regex typo would make the test above vacuous.
    // Rebuilt without /g, whose lastIndex makes .test() stateful between calls.
    const planted = `AIza${'x'.repeat(35)}`
    const hit = KEY_SHAPES.some((shape) => new RegExp(shape.source).test(planted))
    expect(hit).toBe(true)
  })
})
