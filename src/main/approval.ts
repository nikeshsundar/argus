import { dialog } from 'electron'
import { describeAction, type AgentAction } from '../shared/agent'
import { needsApproval } from '../shared/safety'
import { canAskInOverlay, hideOverlay, requestApproval, showOverlay } from './overlayWindow'
import { loadSettings } from './settingsStore'
import { asAgent } from './userPresence'
import type { ApprovalDecision } from '../shared/types'

/**
 * The check every agent and replay step passes through before it runs.
 *
 * Shared so that a saved workflow - which replays with no model watching -
 * cannot send an email the live run needed permission for. `canChange` is
 * false there for the same reason: there is nobody to act on a change.
 *
 * `title` is what was asked about, for the summary when the user says no.
 */
export async function gateAction(
  action: AgentAction,
  task: string,
  signal?: AbortSignal,
  canChange = true
): Promise<ApprovalDecision & { title: string }> {
  const { ask, reason } = needsApproval(action, loadSettings().approvalMode)
  const step = describeAction(action)
  const title = reason || ('purpose' in action && action.purpose) || step
  if (!ask) return { kind: 'allow', title }

  const text = action.type === 'type' || action.type === 'typeInto' ? action.text : undefined

  // Inside asAgent, so clicking Allow is not mistaken for the user taking the
  // machine back - which would pause the very step they just approved.
  const decision = await asAgent(async (): Promise<ApprovalDecision> => {
    if (canAskInOverlay()) {
      return await requestApproval(
        { title, task, step, canChange, ...(text ? { text: preview(text) } : {}) },
        signal
      )
    }
    // The overlay failed to load. Asking in a plain dialog beats not asking.
    hideOverlay()
    try {
      return (await askApproval(action, reason, task)) ? { kind: 'allow' } : { kind: 'stop' }
    } finally {
      showOverlay()
    }
  })
  return { ...decision, title }
}

function preview(text: string): string {
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

/**
 * Fallback for when the overlay is not available: a native dialog that
 * defaults to NOT doing it, so Enter or Escape on a dialog nobody read means
 * Stop. The normal path is the card under the overlay banner.
 */
export async function askApproval(
  action: AgentAction,
  reason: string,
  task: string
): Promise<boolean> {
  const step = describeAction(action)
  const what = reason || ('purpose' in action && action.purpose) || step

  const detail = [
    `Task: ${task}`,
    '',
    `Next step: ${step}`,
    ...(action.type === 'type' || action.type === 'typeInto'
      ? ['', `Text: ${action.text.length > 400 ? `${action.text.slice(0, 400)}…` : action.text}`]
      : []),
    '',
    'Look at your screen - the agent has stopped just before this step.',
    'Nothing happens until you choose.'
  ].join('\n')

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Argus needs your OK',
    message: `Allow the agent to: ${what}?`,
    detail,
    buttons: ['Stop the task', 'Allow this step'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  return response === 1
}
