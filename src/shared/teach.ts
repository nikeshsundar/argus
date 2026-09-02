/**
 * Teach Mode: the app points, the user does it.
 *
 * Agent Mode does the work and leaves the person no wiser. Teach Mode is the
 * opposite trade - slower, but they can do it again tomorrow without us. The
 * app never touches the mouse here; it draws a second, ghost cursor over the
 * real UI and waits.
 */

/** What the learner has to do at a step, which decides the prompt under it. */
export type TeachAction = 'click' | 'type' | 'look'

/** One step of a guided lesson. Coordinates use the same 0-1000 grid as agent actions. */
export interface TeachStep {
  x: number
  y: number
  /** Short imperative - "Click New repository". */
  title: string
  /** One or two sentences on what this does and why. */
  detail: string
  action: TeachAction
  /** 1-based, for "Step 3" in the caption. */
  index: number
}

/** A finished lesson, or one the learner stopped. */
export interface TeachResult {
  ok: boolean
  summary: string
}

/**
 * Phrases that ask to be taught rather than served.
 *
 * Deliberately explicit. "how do i ..." is left out: it is far more often a
 * question wanting an answer than a request for a walkthrough, and guessing
 * wrong drops someone into a lesson they never asked for.
 */
const TEACH_TRIGGER =
  /^\s*(?:teach\s*me|show\s+me\s+how(?:\s+to)?|walk\s+me\s+through|guide\s+me\s+through)\b[,:]?\s*/i

/** Connective left behind once the trigger is removed: "teach me HOW TO open x". */
const LEADING_FILLER = /^(?:how\s+(?:to|do\s+i|i\s+can)|to|about|the\s+way\s+to)\b[,:]?\s*/i

/**
 * Splits "teach me how to create a repo" into the request and its topic.
 *
 * The topic is what reaches the model, so the trigger and its connective are
 * stripped - "create a repo" reads as a goal, "teach me how to create a repo"
 * reads as a meta-question about teaching.
 */
export function parseTeachRequest(text: string): { teach: boolean; topic: string } {
  const trigger = TEACH_TRIGGER.exec(text)
  if (!trigger) return { teach: false, topic: text.trim() }

  let topic = text.slice(trigger[0].length).trim()
  const filler = LEADING_FILLER.exec(topic)
  if (filler) topic = topic.slice(filler[0].length).trim()

  return { teach: true, topic }
}

/** The line under the caption telling the learner how to move on. */
export function advanceHint(action: TeachAction): string {
  switch (action) {
    case 'click':
      return 'Click it — or press Space if you already have'
    case 'type':
      return 'Type it, then press Space'
    case 'look':
      return 'Press Space to continue'
  }
}
