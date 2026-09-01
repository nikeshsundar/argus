import { parseMode } from '../../shared/types'
import { filterOptions, type Option } from './options'

const input = document.querySelector<HTMLInputElement>('#input')!
const chip = document.querySelector<HTMLSpanElement>('#chip')!
const status = document.querySelector<HTMLDivElement>('#status')!
const optionList = document.querySelector<HTMLUListElement>('#options')!
const bar = document.querySelector<HTMLElement>('#bar')!

type StatusState = 'idle' | 'busy' | 'done' | 'error'

/** True between hitting Enter and the answer resolving. */
let awaitingAnswer = false
/** Set once the first streamed chunk lands, so it replaces the busy message. */
let streaming = false
/** Options currently listed, and which one is highlighted (-1 = none). */
let visible: Option[] = []
let highlighted = -1

function setStatus(text: string, state: StatusState = 'idle'): void {
  status.textContent = text
  status.dataset['state'] = state
  status.hidden = !text
}

function syncChip(): void {
  const { mode } = parseMode(input.value)
  chip.dataset['mode'] = mode
  chip.textContent = mode === 'agent' ? 'Agent' : 'Talk'
}

function renderOptions(): void {
  visible = awaitingAnswer ? [] : filterOptions(input.value)
  if (highlighted >= visible.length) highlighted = visible.length - 1

  optionList.replaceChildren(
    ...visible.map((option, index) => {
      const row = document.createElement('li')
      row.className = 'option'
      row.dataset['selected'] = String(index === highlighted)

      const label = document.createElement('span')
      label.className = 'option-label'
      label.textContent = option.label

      const hint = document.createElement('span')
      hint.className = 'option-hint'
      hint.textContent = option.hint

      row.append(label, hint)
      row.addEventListener('mousedown', (event) => {
        event.preventDefault() // keep focus in the input
        choose(option)
      })
      return row
    })
  )
}

function choose(option: Option): void {
  input.value = option.insert
  highlighted = -1
  syncChip()
  renderOptions()

  if (option.immediate) {
    submit(option.insert)
    return
  }
  input.focus()
}

function submit(text: string): void {
  const trimmed = text.trim()
  if (!trimmed || awaitingAnswer) return

  awaitingAnswer = true
  streaming = false
  input.disabled = true
  highlighted = -1
  setStatus('Looking at your screen…', 'busy')
  renderOptions()

  void window.argus
    .submit(trimmed)
    .then((result) => setStatus(result.message, result.ok ? 'done' : 'error'))
    .catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : 'Something went wrong.', 'error')
    )
    .finally(() => {
      awaitingAnswer = false
      streaming = false
      input.disabled = false
      input.focus()
      renderOptions()
    })
}

window.argus.onOpened(({ capture, error, notice }) => {
  awaitingAnswer = false
  streaming = false
  highlighted = -1
  input.value = ''
  input.disabled = false
  syncChip()
  renderOptions()
  input.focus()

  if (error) {
    setStatus(error, 'error')
  } else if (notice) {
    setStatus(notice)
  } else if (capture) {
    setStatus(`Screen captured — ${capture.width}x${capture.height}`)
  } else {
    setStatus('')
  }
})

window.argus.onDelta((delta) => {
  if (!awaitingAnswer) return
  if (!streaming) {
    streaming = true
    setStatus('', 'done')
  }
  status.hidden = false
  status.textContent += delta
})

input.addEventListener('input', () => {
  highlighted = -1
  syncChip()
  renderOptions()
})

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    window.argus.hide()
    return
  }

  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visible.length > 0) {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    highlighted = (highlighted + step + visible.length + 1) % (visible.length + 1) - 1
    renderOptions()
    return
  }

  if (event.key === 'Tab' && highlighted >= 0) {
    event.preventDefault()
    choose(visible[highlighted]!)
    return
  }

  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()

  // A highlighted option wins; otherwise send whatever is typed.
  if (highlighted >= 0) {
    choose(visible[highlighted]!)
    return
  }
  submit(input.value)
})

// Keep the window exactly as tall as its content.
new ResizeObserver(() => {
  const style = getComputedStyle(bar)
  const margins = parseFloat(style.marginTop) + parseFloat(style.marginBottom)
  window.argus.resize(Math.ceil(bar.getBoundingClientRect().height + margins))
}).observe(bar)

syncChip()
renderOptions()
