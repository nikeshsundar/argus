import { advanceHint } from '../../shared/teach'
import type { ApprovalDecision } from '../../shared/types'

const action = document.querySelector<HTMLSpanElement>('#action')!
const step = document.querySelector<HTMLSpanElement>('#step')!
const pointer = document.querySelector<HTMLDivElement>('#pointer')!
const cursorState = document.querySelector<HTMLSpanElement>('#cursor-state')!
/** Clears the "typing" / "scrolling" note once the agent moves on. */
let stateTimer: number | undefined
let pressTimer: number | undefined

const ghost = document.querySelector<HTMLDivElement>('#ghost')!
const captionStep = document.querySelector<HTMLDivElement>('#caption-step')!
const captionTitle = document.querySelector<HTMLDivElement>('#caption-title')!
const captionDetail = document.querySelector<HTMLDivElement>('#caption-detail')!
const captionHint = document.querySelector<HTMLDivElement>('#caption-hint')!

/** Space the caption needs beside the ghost before it has to swap sides. */
const CAPTION_MARGIN = { x: 380, y: 220 }


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
  step.textContent = max > 0 ? `(step ${index}/${max})` : ''
})

window.argus.onAgentCursor(({ x, y, phase }) => {
  pointer.hidden = false
  pointer.style.transform = `translate3d(${x}px, ${y}px, 0)`

  if (phase === 'click') {
    ripple(x, y)
    pointer.classList.add('press')
    window.clearTimeout(pressTimer)
    pressTimer = window.setTimeout(() => pointer.classList.remove('press'), 160)
  }

  if (phase === 'type' || phase === 'scroll') {
    cursorState.textContent = phase === 'type' ? 'typing…' : 'scrolling'
    pointer.classList.toggle('typing', phase === 'type')
    window.clearTimeout(stateTimer)
    stateTimer = window.setTimeout(() => {
      cursorState.textContent = ''
      pointer.classList.remove('typing')
    }, 1400)
  } else if (phase === 'move') {
    // Moving on to something new: whatever it was doing is over.
    window.clearTimeout(stateTimer)
    cursorState.textContent = ''
    pointer.classList.remove('typing')
  }
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

// ---- Approval card ---------------------------------------------------------

const approval = document.querySelector<HTMLDivElement>('#approval')!
const approvalTitle = document.querySelector<HTMLDivElement>('#approval-title')!
const approvalTask = document.querySelector<HTMLDivElement>('#approval-task')!
const approvalText = document.querySelector<HTMLDivElement>('#approval-text')!
const approvalNote = document.querySelector<HTMLInputElement>('#approval-note')!
const approvalChange = document.querySelector<HTMLButtonElement>('#approval-change')!
let approvalId: number | null = null
let bannerBeforeApproval = ''

window.argus.onApproval((request) => {
  if (!request) {
    approval.hidden = true
    approvalId = null
    document.body.dataset['approval'] = 'false'
    if (bannerBeforeApproval) action.textContent = bannerBeforeApproval
    window.argus.setOverlayInteractive(false)
    return
  }

  approvalId = request.id
  approvalTitle.textContent = `${request.title}?`
  approvalTask.textContent = `Task: ${request.task}`
  approvalText.textContent = request.text ?? ''
  approvalText.hidden = !request.text
  approvalNote.value = ''
  approvalNote.hidden = !request.canChange
  approvalChange.hidden = !request.canChange
  approvalChange.disabled = true
  approval.hidden = false
  document.body.dataset['approval'] = 'true'
  bannerBeforeApproval = action.textContent ?? ''
  action.textContent = 'Argus is waiting for your OK'
  step.textContent = ''
})

function answer(decision: ApprovalDecision): void {
  if (approvalId === null) return
  window.argus.answerApproval(approvalId, decision)
}

function requestChange(): void {
  const note = approvalNote.value.trim()
  if (note) answer({ kind: 'change', note })
}

document.querySelector('#approval-allow')!.addEventListener('click', () => answer({ kind: 'allow' }))
document.querySelector('#approval-stop')!.addEventListener('click', () => answer({ kind: 'stop' }))
approvalChange.addEventListener('click', requestChange)

approvalNote.addEventListener('input', () => {
  approvalChange.disabled = !approvalNote.value.trim()
})
approvalNote.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    requestChange()
  }
})

// Typing needs the keyboard, which the overlay otherwise never takes. Borrowed
// only while this box has focus, and handed back when the card closes.
approvalNote.addEventListener('focus', () => window.argus.setOverlayFocus(true))
approvalNote.addEventListener('pointerdown', () => {
  window.argus.setOverlayFocus(true)
  // The window only becomes focusable in response to this, so the click that
  // asked for focus can land before it is possible. Put the caret in after.
  window.setTimeout(() => approvalNote.focus(), 60)
})

// The overlay lets clicks through everywhere else, so the user can still
// scroll and read the email they are being asked about.
approval.addEventListener('mouseenter', () => window.argus.setOverlayInteractive(true))
approval.addEventListener('mouseleave', () => {
  // Mid-sentence, the box must keep taking keystrokes wherever the pointer is.
  if (document.activeElement !== approvalNote) window.argus.setOverlayInteractive(false)
})
