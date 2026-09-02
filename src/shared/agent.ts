/**
 * Actions the model may take while driving the computer.
 *
 * Coordinates are normalised to a 0-1000 grid in both axes, independent of the
 * user's resolution - the same convention Gemini uses for pointing. They are
 * converted to physical pixels by `toScreenPoint` at execution time.
 */
export type AgentAction =
  | { type: 'launch'; name: string }
  | { type: 'openUrl'; url: string }
  | { type: 'click'; x: number; y: number; button: 'left' | 'right'; double: boolean }
  | { type: 'move'; x: number; y: number }
  | { type: 'type'; text: string }
  /**
   * Click a field, type into it, optionally submit - in one turn.
   *
   * The same work as click + type_text + press_keys, which is three model round
   * trips for the single commonest thing anyone does: put text in a box. On a
   * free tier capped at 20 requests a day, collapsing that to one is the
   * difference between finishing a task and running out halfway.
   */
  | { type: 'typeInto'; x: number; y: number; text: string; submit: boolean }
  | { type: 'keys'; keys: string[] }
  | { type: 'scroll'; direction: 'up' | 'down'; clicks: number }
  | { type: 'wait'; seconds: number }
  | { type: 'done'; summary: string }

export interface ScreenSize {
  width: number
  height: number
}

/** Maps a normalised 0-1000 coordinate onto a physical screen pixel. */
export function toScreenPoint(
  x: number,
  y: number,
  screen: ScreenSize
): { x: number; y: number } {
  const clamp = (value: number): number => Math.min(1000, Math.max(0, value))
  return {
    x: Math.round((clamp(x) / 1000) * (screen.width - 1)),
    y: Math.round((clamp(y) / 1000) * (screen.height - 1))
  }
}

/** One-line description of an action, shown live in the bar as the agent works. */
export function describeAction(action: AgentAction): string {
  switch (action.type) {
    case 'launch':
      return `Open ${action.name}`
    case 'openUrl':
      return `Open ${action.url}`
    case 'click':
      return `${action.double ? 'Double-click' : action.button === 'right' ? 'Right-click' : 'Click'} at ${action.x},${action.y}`
    case 'move':
      return `Move to ${action.x},${action.y}`
    case 'type':
      return `Type "${action.text.length > 40 ? `${action.text.slice(0, 40)}…` : action.text}"`
    case 'typeInto': {
      const shown = action.text.length > 30 ? `${action.text.slice(0, 30)}…` : action.text
      return `Type "${shown}" at ${action.x},${action.y}${action.submit ? ' and press Enter' : ''}`
    }
    case 'keys':
      return `Press ${action.keys.join('+')}`
    case 'scroll':
      return `Scroll ${action.direction}`
    case 'wait':
      return `Wait ${action.seconds}s`
    case 'done':
      return action.summary
  }
}
