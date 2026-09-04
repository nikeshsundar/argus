import { advanceHint } from '../../shared/teach'

const action = document.querySelector<HTMLSpanElement>('#action')!
const step = document.querySelector<HTMLSpanElement>('#step')!
const pointer = document.querySelector<HTMLDivElement>('#pointer')!
const followers = Array.from(pointer.querySelectorAll<HTMLDivElement>('.halo, .trail'))

const ghost = document.querySelector<HTMLDivElement>('#ghost')!
const captionStep = document.querySelector<HTMLDivElement>('#caption-step')!
const captionTitle = document.querySelector<HTMLDivElement>('#caption-title')!
const captionDetail = document.querySelector<HTMLDivElement>('#caption-detail')!
const captionHint = document.querySelector<HTMLDivElement>('#caption-hint')!

/** How long the pointer may sit still before the marker dims out of the way. */
const IDLE_AFTER_MS = 900

/** Space the caption needs beside the ghost before it has to swap sides. */
const CAPTION_MARGIN = { x: 380, y: 220 }

let idleTimer: number | undefined

window.argus.onOverlayKind((kind) => {
  document.body.dataset['kind'] = kind
  if (kind === 'teach') {
    action.textContent = 'Argus is showing you how — it will not touch anything'
    step.textContent = ''
  }
})

/** What the banner said before it was interrupted, to put back on resume. */
let drivingText = 'Argus is controlling your PC'

window.argus.onOverlayPaused((text) => {
  document.body.dataset['paused'] = text === null ? 'false' : 'true'
  if (text !== null) {
    action.textContent = text
    step.textContent = ''
    // The pointer marker follows a cursor the agent is no longer moving.
    pointer.hidden = true
  } else {
    action.textContent = drivingText
  }
})

window.argus.onAgentStep(({ description, index, max }) => {
  drivingText = description
  if (document.body.dataset['paused'] === 'true') return
  action.textContent = description
  step.textContent = `(step ${index}/${max})`
})

window.argus.onAgentCursor(({ x, y, phase }) => {
  pointer.hidden = false
  pointer.classList.remove('idle')

  // Every follower is sent to the same point; their differing transition
  // durations are what spreads them into a tail.
  const transform = `translate3d(${x}px, ${y}px, 0)`
  for (const follower of followers) follower.style.transform = transform

  if (phase === 'click') ripple(x, y)

  window.clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => pointer.classList.add('idle'), IDLE_AFTER_MS)
})

window.argus.onTeachStep((event) => {
  if (!event) {
    ghost.hidden = true
    return
  }

  const { step: lesson, x, y } = event

  captionStep.textContent = `Step ${lesson.index}`
  captionTitle.textContent = lesson.title
  captionDetail.textContent = lesson.detail
  captionDetail.hidden = !lesson.detail
  captionHint.textContent = advanceHint(lesson.action)

  // The caption hangs below-right by default; near an edge that would put it
  // off screen, so it swaps to whichever side has room.
  ghost.dataset['flipX'] = String(x + CAPTION_MARGIN.x > window.innerWidth)
  ghost.dataset['flipY'] = String(y + CAPTION_MARGIN.y > window.innerHeight)
  ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`
  ghost.hidden = false

  action.textContent = lesson.title
  step.textContent = `(step ${lesson.index})`
})

/** One expanding ring at the click point, removed once it has played. */
function ripple(x: number, y: number): void {
  const ring = document.createElement('div')
  ring.className = 'ripple'
  ring.style.transform = `translate3d(${x}px, ${y}px, 0)`
  ring.addEventListener('animationend', () => ring.remove(), { once: true })
  document.body.append(ring)
}
