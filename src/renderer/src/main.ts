import { parseMode } from '../../shared/types'

const input = document.querySelector<HTMLInputElement>('#input')!
const chip = document.querySelector<HTMLSpanElement>('#chip')!
const status = document.querySelector<HTMLDivElement>('#status')!

type StatusState = 'idle' | 'busy' | 'done' | 'error'

function setStatus(text: string, state: StatusState = 'idle'): void {
  status.textContent = text
  status.dataset['state'] = state
}

function syncChip(): void {
  chip.dataset['mode'] = parseMode(input.value).mode
  chip.textContent = parseMode(input.value).mode === 'agent' ? 'Agent' : 'Talk'
}

function reset(): void {
  input.value = ''
  syncChip()
}

window.argus.onOpened(({ capture, error }) => {
  reset()
  input.focus()
  input.select()

  if (error) {
    setStatus(error, 'error')
  } else if (capture) {
    setStatus(`Screen captured — ${capture.width}x${capture.height}. What do you want to know?`)
  }
})

input.addEventListener('input', syncChip)

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    window.argus.hide()
    return
  }

  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()

  const text = input.value.trim()
  if (!text) return

  setStatus('Thinking…', 'busy')
  void window.argus
    .submit(text)
    .then((result) => setStatus(result.message, result.ok ? 'done' : 'error'))
    .catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : 'Something went wrong.', 'error')
    )
})

syncChip()
