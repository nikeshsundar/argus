/**
 * The checker's answer, read defensively.
 *
 * Anything that is not a clear "complete: false" counts as complete. The
 * checker exists to catch confident wrong claims, and a garbled reply is not
 * evidence of one - failing a finished task over a formatting slip would be
 * a hallucination of its own.
 */
export interface Verdict {
  complete: boolean
  problem: string
}

export function parseVerdict(text: string): Verdict {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) return { complete: true, problem: '' }
  try {
    const raw = JSON.parse(json) as { complete?: unknown; problem?: unknown }
    const complete = raw.complete !== false && raw.complete !== 'false'
    const problem = typeof raw.problem === 'string' ? raw.problem.trim() : ''
    return complete ? { complete: true, problem: '' } : { complete: false, problem: problem || 'the screen does not show the task finished' }
  } catch {
    return { complete: true, problem: '' }
  }
}

/** How many times a finish can be sent back before the run ends unconfirmed. */
export const MAX_REJECTIONS = 2
