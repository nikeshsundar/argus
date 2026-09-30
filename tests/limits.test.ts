import { describe, expect, it } from 'vitest'
import type { AgentAction } from '../src/shared/agent'
import {
  checkLimits,
  healLimits,
  hostOf,
  NO_LIMITS,
  parseLimitsCommand,
  type Limits
} from '../src/shared/limits'

const limits = (patch: Partial<Limits>): Limits => ({ ...NO_LIMITS, ...patch })
const click = (purpose: string): AgentAction => ({
  type: 'click',
  x: 1,
  y: 1,
  button: 'left',
  double: false,
  purpose
})
const inWindow = (title: string | null) => ({ windowTitle: title })

describe('app limits', () => {
  const onlyChrome = limits({ apps: ['chrome'] })

  it('allows work in an allowed app, going by the real window title', () => {
    expect(checkLimits(click('Click Compose'), onlyChrome, inWindow('Inbox - Gmail - Google Chrome'))).toBeNull()
  })

  it('blocks work in any other window, whatever the model thinks it is looking at', () => {
    expect(checkLimits(click('Click Compose in Gmail'), onlyChrome, inWindow('Downloads - File Explorer'))).toMatch(
      /not one of your allowed apps/
    )
  })

  it('blocks clicking around the desktop or taskbar', () => {
    expect(checkLimits(click('Click the Start button'), onlyChrome, inWindow(''))).toMatch(/desktop or taskbar/)
  })

  it('blocks launching other programs', () => {
    expect(checkLimits({ type: 'launch', name: 'Notepad' }, onlyChrome, inWindow(null))).toMatch(/Notepad/)
    expect(checkLimits({ type: 'launch', name: 'Google Chrome' }, onlyChrome, inWindow(null))).toBeNull()
  })

  it('allows a web app by the page name in its browser title', () => {
    const onlyGmail = limits({ apps: ['gmail'] })
    expect(checkLimits(click('Click Send'), onlyGmail, inWindow('Compose Mail - Gmail - Google Chrome'))).toBeNull()
    expect(checkLimits(click('Click Send'), onlyGmail, inWindow('YouTube - Google Chrome'))).toBeTruthy()
  })

  it('does not guess when the window title cannot be read', () => {
    expect(checkLimits(click('Click Compose'), onlyChrome, inWindow(null))).toBeNull()
  })
})

describe('site limits', () => {
  const onlyMail = limits({ sites: ['gmail.com', 'mail.google.com'] })

  it('allows the listed sites and their subdomains', () => {
    expect(checkLimits({ type: 'openUrl', url: 'https://mail.google.com/mail/u/0' }, onlyMail, inWindow(null))).toBeNull()
  })

  it('blocks opening anything else', () => {
    expect(checkLimits({ type: 'openUrl', url: 'https://evil.example.com' }, onlyMail, inWindow(null))).toMatch(
      /evil\.example\.com/
    )
  })

  it('blocks typing another address into the address bar', () => {
    const typed: AgentAction = { type: 'typeInto', x: 1, y: 1, text: 'https://youtube.com', submit: true }
    expect(checkLimits(typed, onlyMail, inWindow(null))).toMatch(/youtube\.com/)
  })

  it('does not treat ordinary typed text as an address', () => {
    const typed: AgentAction = { type: 'typeInto', x: 1, y: 1, text: 'meeting notes', submit: true }
    expect(checkLimits(typed, onlyMail, inWindow(null))).toBeNull()
  })

  it('reads hosts from bare and full addresses', () => {
    expect(hostOf('www.GitHub.com/foo')).toBe('github.com')
    expect(hostOf('https://docs.new')).toBe('docs.new')
    expect(hostOf('hello world')).toBeNull()
  })
})

describe('forbidden actions', () => {
  const noDelete = limits({ never: ['delete', 'send'] })

  it('blocks outright, rather than asking', () => {
    expect(checkLimits(click('Delete the selected emails'), noDelete, inWindow(null))).toMatch(/Deleting/)
    expect(checkLimits(click('Click Send'), noDelete, inWindow(null))).toMatch(/Sending/)
  })

  it('blocks the keyboard shortcut as well as the button', () => {
    expect(checkLimits({ type: 'keys', keys: ['shift', 'delete'] }, noDelete, inWindow(null))).toBeTruthy()
    expect(checkLimits({ type: 'keys', keys: ['control', 'enter'] }, noDelete, inWindow(null))).toBeTruthy()
  })

  it('lets the agent write about a forbidden thing, just not do it', () => {
    const writing: AgentAction = { type: 'type', text: 'Please send the payment and delete the old file.' }
    expect(checkLimits(writing, noDelete, inWindow(null))).toBeNull()
  })

  it('blocks settings tools when settings are off', () => {
    expect(
      checkLimits({ type: 'launch', name: 'PowerShell' }, limits({ never: ['settings'] }), inWindow(null))
    ).toBeTruthy()
  })
})

describe('parseLimitsCommand', () => {
  it('shows the limits', () => {
    expect(parseLimitsCommand('/limits', NO_LIMITS)).toEqual({ kind: 'show' })
  })

  it('sets and clears each kind', () => {
    const apps = parseLimitsCommand('/limits apps chrome, vs code', NO_LIMITS)
    expect(apps.kind === 'set' && apps.limits.apps).toEqual(['chrome', 'vscode'])

    const sites = parseLimitsCommand('/limits sites https://www.gmail.com docs.google.com', NO_LIMITS)
    expect(sites.kind === 'set' && sites.limits.sites).toEqual(['gmail.com', 'docs.google.com'])

    const never = parseLimitsCommand('/limits never delete, paying', NO_LIMITS)
    expect(never.kind === 'set' && never.limits.never).toEqual(['delete', 'pay'])

    const steps = parseLimitsCommand('/limits steps 20', NO_LIMITS)
    expect(steps.kind === 'set' && steps.limits.maxSteps).toBe(20)

    const cleared = parseLimitsCommand('/limits apps any', limits({ apps: ['chrome'] }))
    expect(cleared.kind === 'set' && cleared.limits.apps).toEqual([])
  })

  it('refuses nonsense instead of saving it', () => {
    expect(parseLimitsCommand('/limits never fly', NO_LIMITS).kind).toBe('bad')
    expect(parseLimitsCommand('/limits steps lots', NO_LIMITS).kind).toBe('bad')
    expect(parseLimitsCommand('/limits colour red', NO_LIMITS).kind).toBe('bad')
  })

  it('leaves other commands alone', () => {
    expect(parseLimitsCommand('/list', NO_LIMITS)).toEqual({ kind: 'none' })
  })
})

describe('healLimits', () => {
  it('repairs a hand-edited settings file', () => {
    expect(healLimits({ apps: 'chrome', never: ['delete', 'explode'], maxSteps: -3 })).toEqual({
      ...NO_LIMITS,
      never: ['delete']
    })
    expect(healLimits(undefined)).toEqual(NO_LIMITS)
  })
})
