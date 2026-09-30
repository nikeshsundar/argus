import { describe, expect, it } from 'vitest'
import {
  createKeyGate,
  parallelSavings,
  parseSopCommand,
  parseSopPlan,
  sopReport,
  SOP_MAX_STEPS,
  type SopOutcome
} from '../src/shared/sop'

describe('parseSopPlan', () => {
  it('reads a plan and renumbers the steps', () => {
    const plan = parseSopPlan(
      JSON.stringify({
        goal: 'Email the team',
        steps: [
          { id: 'body', title: 'Draft email', kind: 'write', instruction: 'Write the email.' },
          { id: 'send', title: 'Send it', kind: 'screen', instruction: 'Paste and send.', needs: ['body'] }
        ]
      })
    )
    expect(plan?.goal).toBe('Email the team')
    expect(plan?.steps.map((step) => [step.id, step.kind, step.needs])).toEqual([
      ['s1', 'write', []],
      ['s2', 'screen', ['s1']]
    ])
  })

  it('only keeps dependencies on earlier steps, so nothing can deadlock', () => {
    const plan = parseSopPlan(
      JSON.stringify({
        goal: 'x',
        steps: [
          { id: 'a', title: 'A', kind: 'write', instruction: 'a', needs: ['b', 'a'] },
          { id: 'b', title: 'B', kind: 'write', instruction: 'b', needs: ['a', 'ghost'] }
        ]
      })
    )
    expect(plan?.steps[0]?.needs).toEqual([])
    expect(plan?.steps[1]?.needs).toEqual(['s1'])
  })

  it('treats anything unclear as screen work, and only writers may search', () => {
    const plan = parseSopPlan(
      JSON.stringify({
        steps: [
          { title: 'X', kind: 'mystery', instruction: 'do it', web: true },
          { title: 'Y', kind: 'write', instruction: 'write it', web: true }
        ]
      })
    )
    expect(plan?.steps.map((step) => [step.kind, step.web])).toEqual([
      ['screen', false],
      ['write', true]
    ])
  })

  it('drops empty steps, caps the length and survives junk', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ kind: 'write', instruction: `do ${index}` }))
    expect(parseSopPlan(JSON.stringify({ steps: many }))?.steps).toHaveLength(SOP_MAX_STEPS)
    expect(parseSopPlan(JSON.stringify({ steps: [{ kind: 'write', instruction: '  ' }] }))).toBeNull()
    expect(parseSopPlan('not json')).toBeNull()
    expect(parseSopPlan('{"steps": "nope"}')).toBeNull()
  })
})

describe('createKeyGate', () => {
  it('gives each writer its own key and queues the rest', async () => {
    const gate = createKeyGate(2)
    const first = await gate.acquire()
    const second = await gate.acquire()
    expect([first, second].sort()).toEqual([0, 1])

    let third: number | null = null
    const waiting = gate.acquire().then((slot) => (third = slot))
    await Promise.resolve()
    expect(third).toBeNull() // both keys busy

    gate.release(first)
    await waiting
    expect(third).toBe(first) // the freed key is handed straight on
    expect(gate.busy).toBe(2)
  })
})

describe('parallelSavings', () => {
  it('compares one-after-another with side-by-side', () => {
    expect(
      parallelSavings([
        { start: 0, end: 10_000 },
        { start: 0, end: 8_000 },
        { start: 1_000, end: 9_000 }
      ])
    ).toEqual({ workMs: 26_000, wallMs: 10_000, savedMs: 16_000 })
    expect(parallelSavings([])).toEqual({ workMs: 0, wallMs: 0, savedMs: 0 })
  })
})

describe('sopReport', () => {
  const plan = parseSopPlan(
    JSON.stringify({
      goal: 'Send two updates',
      steps: [
        { id: 'a', title: 'Draft mail', kind: 'write', instruction: 'w' },
        { id: 'b', title: 'Draft post', kind: 'write', instruction: 'w' },
        { id: 'c', title: 'Send mail', kind: 'screen', instruction: 's', needs: ['a'] }
      ]
    })
  )!

  it('lists every step, the time saved, and prints texts nothing used', () => {
    const outcomes = new Map<string, SopOutcome>([
      ['s1', { status: 'done', detail: 'written in 9.0s on key 1', text: 'Hi team', key: 1 }],
      ['s2', { status: 'done', detail: 'written in 8.0s on key 2', text: 'Big news today', key: 2 }],
      ['s3', { status: 'failed', detail: 'you did not approve it' }]
    ])
    const report = sopReport(plan, outcomes, [{ start: 0, end: 9_000 }, { start: 0, end: 8_000 }], 2, 20_000)

    expect(report).toContain('2 of 3 steps done')
    expect(report).toContain('✓ 1. Draft mail (writer)')
    expect(report).toContain('✗ 3. Send mail (screen) — you did not approve it')
    expect(report).toContain('saved ~8.0s')
    // The post was never pasted anywhere, so the report is where it lives.
    expect(report).toContain('— Draft post —\nBig news today')
    // The mail was handed to a screen step, so it is not repeated in full.
    expect(report).not.toContain('Hi team')
  })
})

describe('parseSopCommand', () => {
  it('reads /sop and sop:', () => {
    expect(parseSopCommand('/sop write 3 emails')).toEqual({ sop: 'write 3 emails' })
    expect(parseSopCommand('SOP: 1. open gmail / 2. send')).toEqual({ sop: '1. open gmail / 2. send' })
    expect(parseSopCommand('/sop')).toEqual({ sop: '' })
  })

  it('leaves everything else alone', () => {
    expect(parseSopCommand('sophisticated question')).toBeNull()
    expect(parseSopCommand('/save x')).toBeNull()
  })
})
