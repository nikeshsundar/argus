import { parseMode } from '../../shared/types'

const input = document.querySelector<HTMLInputElement>('#input')!
const chip = document.querySelector<HTMLSpanElement>('#chip')!
const status = document.querySelector<HTMLDivElement>('#status')!
const bar = document.querySelector<HTMLElement>('#bar')!

type StatusState = 'idle' | 'busy' | 'done' | 'error'

/** True between hitting Enter and the answer resolving. */
let awaitingAnswer = false
/** Set once the first streamed chunk lands, so it replaces the busy message. */
let streaming = false

function setStatus(text: string, state: StatusState = 'idle'): void {
  status.textContent = text
  status.dataset['state'] = state
}

function syncChip(): void {
  const { mode } = parseMode(input.value)
  chip.dataset['mode'] = mode
  chip.textContent = mode === 'agent' ? 'Agent' : 'Talk'
}

window.argus.onOpened(({ capture, error }) => {
  awaitingAnswer = false
  streaming = false
  input.value = ''
  input.disabled = false
  syncChip()
  input.focus()

  if (error) {
    setStatus(error, 'error')
  } else if (capture) {
    setStatus(`Screen captured — ${capture.width}x${capture.height}. What do you want to know?`)
  }
})

window.argus.onDelta((delta) => {
  if (!awaitingAnswer) return
  if (!streaming) {
    streaming = true
    setStatus('', 'done')
  }
  status.textContent += delta
})

input.addEventListener('input', syncChip)

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    window.argus.hide()
    return
  }

  if (event.key !== 'Enter' || event.isComposing || awaitingAnswer) return
  event.preventDefault()

  const text = input.value.trim()
  if (!text) return

  awaitingAnswer = true
  streaming = false
  input.disabled = true
  setStatus('Looking at your screen…', 'busy')

  void window.argus
    .submit(text)
    .then((result) => setStatus(result.message, result.ok ? 'done' : 'error'))
    .catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : 'Something went wrong.', 'error')
    )
    .finally(() => {
      awaitingAnswer = false
      streaming = false
      input.disabled = false
      input.focus()
    })
})

// Keep the window exactly as tall as its content.
new ResizeObserver(() => {
  const style = getComputedStyle(bar)
  const margins = parseFloat(style.marginTop) + parseFloat(style.marginBottom)
  window.argus.resize(Math.ceil(bar.getBoundingClientRect().height + margins))
}).observe(bar)

syncChip()
