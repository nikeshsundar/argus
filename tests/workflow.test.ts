import { describe, expect, it } from 'vitest'
import type { AgentAction, ScreenSize } from '../src/shared/agent'
import {
  describeWorkflow,
  estimateMs,
  findWorkflow,
  formatDuration,
  MAX_NAME_LENGTH,
  nameProblem,
  normaliseName,
  parseWorkflowCommand,
  previewLines,
  recordable,
  screenDrifted,
  suggestNames,
  type Workflow
} from '../src/shared/workflow'

const SCREEN: ScreenSize = { width: 1920, height: 1080 }

const flow = (name: string, over: Partial<Workflow> = {}): Workflow => ({
  name,
  task: `do ${name}`,
  actions: [{ type: 'click', x: 500, y: 500, button: 'left', double: false }],
  createdAt: 0,
  runs: 0,
  screen: SCREEN,
  ...over
})

describe('normaliseName', () => {
  it('ignores case and stray spacing, which is how people retype a name', () => {
    expect(normaliseName('  Morning   Setup ')).toBe('morning setup')
  })
})

describe('nameProblem', () => {
  it('accepts an ordinary name', () => {
    expect(nameProblem('morning')).toBeNull()
    expect(nameProblem('deploy the site')).toBeNull()
  })

  it('rejects an empty name rather than saving something unaddressable', () => {
    expect(nameProblem('   ')).toContain('Give it a name')
  })

  it('rejects a name that would be read as a command', () => {
    expect(nameProblem('/run')).toContain('cannot start with')
  })

  it('rejects a name longer than the limit', () => {
    expect(nameProblem('x'.repeat(MAX_NAME_LENGTH + 1))).toContain('under')
    expect(nameProblem('x'.repeat(MAX_NAME_LENGTH))).toBeNull()
  })

  it('rejects words the bar already uses, which could never be typed to run', () => {
    // "agent morning" strips the prefix and looks for a task called "morning";
    // a workflow actually named "agent" can never be reached that way.
    for (const reserved of ['agent', 'Agent', 'ask', 'talk', 'teach me']) {
      expect(nameProblem(reserved), reserved).toContain('already means something')
    }
  })
})

describe('recordable', () => {
  it('drops the done action, which is an announcement not a step', () => {
    const actions: AgentAction[] = [
      { type: 'launch', name: 'Chrome' },
      { type: 'done', summary: 'opened it' }
    ]
    expect(recordable(actions)).toEqual([{ type: 'launch', name: 'Chrome' }])
  })

  it('drops trailing waits, which existed to watch for a result', () => {
    const actions: AgentAction[] = [
      { type: 'launch', name: 'Chrome' },
      { type: 'wait', seconds: 2 },
      { type: 'wait', seconds: 3 }
    ]
    expect(recordable(actions)).toEqual([{ type: 'launch', name: 'Chrome' }])
  })

  it('keeps a wait in the middle, where it is load-bearing', () => {
    const actions: AgentAction[] = [
      { type: 'launch', name: 'Chrome' },
      { type: 'wait', seconds: 2 },
      { type: 'click', x: 1, y: 2, button: 'left', double: false }
    ]
    expect(recordable(actions)).toHaveLength(3)
  })

  it('reports a run that did nothing as empty, so it is not offered', () => {
    expect(recordable([{ type: 'done', summary: 'nothing to do' }])).toEqual([])
  })
})

describe('parseWorkflowCommand', () => {
  it('reads the plural list command before treating it as a name', () => {
    expect(parseWorkflowCommand('/workflows')).toEqual({ kind: 'list' })
  })

  it('does not read "/workflows clear" as showing a workflow called clear', () => {
    // The bug this mirrors: "/keys" being parsed as "/key" plus an argument.
    // Here it would report success while deleting nothing.
    expect(parseWorkflowCommand('/workflows clear')).toEqual({ kind: 'clear' })
  })

  it('reads every wording of delete', () => {
    for (const verb of ['delete', 'remove', 'forget']) {
      expect(parseWorkflowCommand(`/workflows ${verb} morning`)).toEqual({
        kind: 'delete',
        name: 'morning'
      })
    }
  })

  it('reads a bare name as a request to show it', () => {
    expect(parseWorkflowCommand('/workflows morning')).toEqual({ kind: 'show', name: 'morning' })
  })

  it('reads save and run with their names', () => {
    expect(parseWorkflowCommand('/save morning')).toEqual({ kind: 'save', name: 'morning' })
    expect(parseWorkflowCommand('/run morning')).toEqual({ kind: 'run', name: 'morning' })
  })

  it('claims save and run even with no name, so the error can explain', () => {
    // Falling through to "unknown command" would be a lie: the command is
    // known, the argument is missing, and only one of those is worth saying.
    expect(parseWorkflowCommand('/save')).toEqual({ kind: 'save', name: '' })
    expect(parseWorkflowCommand('/run')).toEqual({ kind: 'run', name: '' })
  })

  it('accepts the separators people actually type', () => {
    expect(parseWorkflowCommand('/save: morning')).toEqual({ kind: 'save', name: 'morning' })
    expect(parseWorkflowCommand('/run=morning')).toEqual({ kind: 'run', name: 'morning' })
  })

  it('keeps a multi-word name whole', () => {
    expect(parseWorkflowCommand('/save morning setup')).toEqual({
      kind: 'save',
      name: 'morning setup'
    })
  })

  it('ignores anything that is not one of its commands', () => {
    for (const text of ['/key abc', 'open instagram', '/saved', '/running', '']) {
      expect(parseWorkflowCommand(text), text).toEqual({ kind: 'none' })
    }
  })
})

describe('findWorkflow', () => {
  const list = [flow('morning'), flow('morning email'), flow('deploy')]

  it('prefers an exact match over a longer name starting the same way', () => {
    expect(findWorkflow('morning', list)?.name).toBe('morning')
  })

  it('accepts an unambiguous prefix', () => {
    expect(findWorkflow('dep', list)?.name).toBe('deploy')
  })

  it('refuses an ambiguous prefix rather than guessing', () => {
    // Guessing here means the machine carrying out the wrong task unattended.
    expect(findWorkflow('mor', [flow('morning'), flow('morning email')])).toBeNull()
  })

  it('matches regardless of case and spacing', () => {
    expect(findWorkflow('  MORNING  Email ', list)?.name).toBe('morning email')
  })

  it('finds nothing for an empty name', () => {
    expect(findWorkflow('   ', list)).toBeNull()
  })
})

describe('suggestNames', () => {
  it('offers names that contain what was typed', () => {
    expect(suggestNames('mail', [flow('morning email'), flow('deploy')])).toEqual(['morning email'])
  })

  it('offers the whole list when nothing was typed', () => {
    expect(suggestNames('', [flow('a'), flow('b')])).toEqual(['a', 'b'])
  })
})

describe('estimateMs', () => {
  it('is zero-ish for an empty workflow', () => {
    expect(estimateMs([], 'natural', SCREEN)).toBe(0)
  })

  it('counts the wait it was told to take', () => {
    const withWait = estimateMs([{ type: 'wait', seconds: 3 }], 'instant', SCREEN)
    expect(withWait).toBeGreaterThanOrEqual(3000)
  })

  it('charges for typing, since each keystroke is delayed on purpose', () => {
    const short = estimateMs([{ type: 'type', text: 'hi' }], 'demo', SCREEN)
    const long = estimateMs([{ type: 'type', text: 'hi'.repeat(50) }], 'demo', SCREEN)
    expect(long).toBeGreaterThan(short)
  })

  it('makes a demo-paced run longer than a natural one', () => {
    const actions: AgentAction[] = [
      { type: 'click', x: 0, y: 0, button: 'left', double: false },
      { type: 'click', x: 1000, y: 1000, button: 'left', double: false }
    ]
    expect(estimateMs(actions, 'demo', SCREEN)).toBeGreaterThan(
      estimateMs(actions, 'natural', SCREEN)
    )
  })

  it('allows for the app launch that inputSim actually waits through', () => {
    expect(estimateMs([{ type: 'launch', name: 'Chrome' }], 'instant', SCREEN)).toBeGreaterThanOrEqual(1500)
  })
})

describe('formatDuration', () => {
  it('never claims something takes zero seconds', () => {
    expect(formatDuration(0)).toBe('about 1s')
    expect(formatDuration(120)).toBe('about 1s')
  })

  it('reads as seconds under a minute and minutes over', () => {
    expect(formatDuration(4_000)).toBe('about 4s')
    expect(formatDuration(60_000)).toBe('about 1m')
    expect(formatDuration(80_000)).toBe('about 1m 20s')
  })
})

describe('describeWorkflow', () => {
  it('says how many steps and whether it has ever been used', () => {
    expect(describeWorkflow(flow('morning'))).toContain('1 step,')
    expect(describeWorkflow(flow('morning'))).toContain('never run')
    expect(describeWorkflow(flow('morning', { runs: 3 }))).toContain('run 3 times')
  })

  it('pluralises steps', () => {
    const two = flow('x', {
      actions: [
        { type: 'wait', seconds: 1 },
        { type: 'wait', seconds: 1 }
      ]
    })
    expect(describeWorkflow(two)).toContain('2 steps')
  })
})

describe('previewLines', () => {
  it('numbers the steps from one, matching what the overlay counts', () => {
    const lines = previewLines(
      flow('x', {
        actions: [
          { type: 'launch', name: 'Chrome' },
          { type: 'type', text: 'hello' }
        ]
      })
    )
    expect(lines[0]).toBe('1. Open Chrome')
    expect(lines[1]).toBe('2. Type "hello"')
  })
})

describe('screenDrifted', () => {
  it('allows a different resolution at the same shape', () => {
    // Coordinates are normalised, so 1080p to 4K scales cleanly.
    expect(screenDrifted({ width: 1920, height: 1080 }, { width: 3840, height: 2160 })).toBe(false)
  })

  it('flags a change of aspect ratio, which moves every control', () => {
    expect(screenDrifted({ width: 1920, height: 1080 }, { width: 3440, height: 1440 })).toBe(true)
    expect(screenDrifted({ width: 1920, height: 1080 }, { width: 1280, height: 1024 })).toBe(true)
  })

  it('tolerates a rounding-sized difference', () => {
    expect(screenDrifted({ width: 1920, height: 1080 }, { width: 1918, height: 1080 })).toBe(false)
  })

  it('says nothing drifted when a size is missing, rather than blocking', () => {
    // Workflows saved before the screen was recorded have zeroes. Refusing to
    // replay them would be worse than letting the user watch and press Escape.
    expect(screenDrifted({ width: 0, height: 0 }, SCREEN)).toBe(false)
  })
})
