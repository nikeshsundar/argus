import { describeAction, type AgentAction } from './agent'

/**
 * Noticing when the agent is going in circles.
 *
 * A step reports "ok" when the input was delivered, which is not the same as
 * the input having worked. Type a URL that autocompletes to the wrong page and
 * the action succeeded perfectly; it is the outcome that is wrong. The model
 * gets a fresh screenshot each turn and is supposed to notice, but a fast
 * model told only "ok" will happily do the identical thing again, and again,
 * until the step limit ends the task with nothing to show.
 *
 * So repetition is detected here and said out loud. Being told "you have now
 * done this twice and the screen has not changed" is a far stronger signal
 * than a screenshot the model has already misread once.
 */

/**
 * Coordinates are noisy - a model aiming at the same button twice will not
 * name the same pixel. Rounded onto a coarse grid so "the same click" means
 * what a person means by it.
 */
const GRID = 25

/** Two actions with the same signature are the same attempt. */
export function actionSignature(action: AgentAction): string {
  const at = (x: number, y: number): string =>
    `${Math.round(x / GRID) * GRID},${Math.round(y / GRID) * GRID}`

  switch (action.type) {
    case 'launch':
      return `launch:${action.name.toLowerCase()}`
    case 'openUrl':
      return `open:${action.url.toLowerCase()}`
    case 'click':
      return `click:${at(action.x, action.y)}:${action.button}:${action.double}`
    case 'move':
      return `move:${at(action.x, action.y)}`
    case 'typeInto':
      return `typeInto:${at(action.x, action.y)}:${action.text.toLowerCase()}:${action.submit}`
    case 'type':
      return `type:${action.text.toLowerCase()}`
    case 'keys':
      return `keys:${action.keys.map((one) => one.toLowerCase()).join('+')}`
    case 'scroll':
      return `scroll:${action.direction}`
    case 'wait':
      return 'wait'
    case 'done':
      return 'done'
  }
}

/**
 * How many identical attempts before the task is abandoned.
 *
 * Three, not two: the second is often legitimate - a click that missed by a
 * few pixels, a page that had not finished painting. By the third, nothing
 * about the situation is going to change on its own, and the remaining steps
 * would be spent proving it.
 */
export const REPEAT_LIMIT = 3

/** Identical attempts at the end of the run, counting the most recent. */
export function repeatCount(attempts: AgentAction[]): number {
  if (attempts.length === 0) return 0

  const last = actionSignature(attempts[attempts.length - 1]!)
  let count = 0
  for (let index = attempts.length - 1; index >= 0; index--) {
    if (actionSignature(attempts[index]!) !== last) break
    count++
  }
  return count
}

/**
 * What to tell the model about its own repetition, or null when it is making
 * progress.
 *
 * Deliberately blunt, and it names the likely cause. A model that has just
 * typed into an address bar and landed on the wrong page almost never works
 * out that autocomplete did it; told to check for exactly that, it does.
 */
export function loopAdvice(attempts: AgentAction[]): string | null {
  const repeats = repeatCount(attempts)
  if (repeats < 2) return null

  const last = attempts[attempts.length - 1]!
  const what = describeAction(last)

  const lines = [
    `STOP. You have now done "${what}" ${repeats} times in a row and the screen has not become what you wanted.`,
    'Doing it a third time will not work either. The action itself succeeded - it is the result that is wrong, so look at the screenshot and work out why.'
  ]

  if (last.type === 'typeInto' || last.type === 'type') {
    lines.push(
      'If you typed into a browser address bar and landed somewhere unexpected, the browser autocompleted your text to an old link from history. Type the full address including https:// rather than a bare word.'
    )
  }
  if (last.type === 'click') {
    lines.push(
      'If a click is doing nothing, you are probably a little off the control, it is covered by something, or the page has moved since the screenshot.'
    )
  }

  lines.push('Try a different approach, or call task_done and say plainly what is blocking you.')
  return lines.join(' ')
}

/** True once repeating has gone past the point of being worth another try. */
export function isStuck(attempts: AgentAction[]): boolean {
  return repeatCount(attempts) >= REPEAT_LIMIT
}

/** The summary for a task given up on because it was going in circles. */
export function stuckSummary(attempts: AgentAction[]): string {
  const last = attempts[attempts.length - 1]
  const what = last ? describeAction(last) : 'the same action'
  return (
    `Stopped: I tried "${what}" ${REPEAT_LIMIT} times and the screen never changed the way it needed to. ` +
    'Rather than spend the rest of the steps repeating it, I have stopped. Tell me what to do differently and I will pick it up from here.'
  )
}
