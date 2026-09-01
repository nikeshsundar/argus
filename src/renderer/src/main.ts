import { parseMode } from '../../shared/types'
import { filterOptions, type Option } from './options'

const input = document.querySelector<HTMLInputElement>('#input')!
const chip = document.querySelector<HTMLSpanElement>('#chip')!
const status = document.querySelector<HTMLDivElement>('#status')!
const thread = document.querySelector<HTMLDivElement>('#thread')!
const optionList = document.querySelector<HTMLUListElement>('#options')!
const closeButton = document.querySelector<HTMLButtonElement>('#close')!
const bar = document.querySelector<HTMLElement>('#bar')!

type StatusState = 'idle' | 'busy' | 'done' | 'error'

/** True between hitting Enter and the answer resolving. */
let awaitingAnswer = false
/** Set once the first streamed chunk lands, so it replaces the busy message. */
let streaming = false
/** Options currently listed, and which one is highlighted (-1 = none). */
let visible: Option[] = []
let highlighted = -1
/** Timestamp of the last Escape, for the double-tap-to-close gesture. */
let lastEscape = 0
/** The answer element currently being streamed into. */
let activeAnswer: HTMLDivElement | null = null

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

/** Appends a question to the transcript and returns its (empty) answer node. */
function appendExchange(question: string): HTMLDivElement {
  const block = document.createElement('div')
  block.className = 'turn'

  const asked = document.createElement('div')
  asked.className = 'turn-q'
  asked.textContent = question

  const answer = document.createElement('div')
  answer.className = 'turn-a'

  block.append(asked, answer)
  thread.append(block)
  thread.scrollTop = thread.scrollHeight
  return answer
}

function clearThread(): void {
  thread.replaceChildren()
  activeAnswer = null
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

  const isCommand = trimmed.startsWith('/')
  awaitingAnswer = true
  streaming = false
  input.disabled = true
  highlighted = -1

  // Commands report through the status line; questions join the transcript.
  activeAnswer = isCommand ? null : appendExchange(trimmed)
  setStatus(isCommand ? 'Working…' : 'Looking at your screen…', 'busy')
  renderOptions()

  void window.argus
    .submit(trimmed)
    .then((result) => {
      if (activeAnswer && result.ok) {
        activeAnswer.textContent = result.message
        setStatus('')
      } else {
        if (activeAnswer && !result.ok) activeAnswer.remove()
        setStatus(result.message, result.ok ? 'done' : 'error')
      }
    })
    .catch((error: unknown) => {
      activeAnswer?.remove()
      setStatus(error instanceof Error ? error.message : 'Something went wrong.', 'error')
    })
    .finally(() => {
      awaitingAnswer = false
      streaming = false
      activeAnswer = null
      input.disabled = false
      input.value = ''
      syncChip()
      input.focus()
      renderOptions()
      thread.scrollTop = thread.scrollHeight
    })
}

window.argus.onOpened(({ capture, error, notice }) => {
  awaitingAnswer = false
  streaming = false
  highlighted = -1
  input.value = ''
  input.disabled = false
  clearThread()
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
    setStatus('')
  }
  if (activeAnswer) {
    activeAnswer.textContent += delta
    thread.scrollTop = thread.scrollHeight
  }
})

window.argus.onAgentStep((event) => {
  setStatus(`${event.description} (step ${event.index}/${event.max})`, 'busy')
})

closeButton.addEventListener('click', () => window.argus.hide())

input.addEventListener('input', () => {
  highlighted = -1
  syncChip()
  renderOptions()
})

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()

    // One tap clears what's typed; a second closes. That way a stray Escape
    // never throws away an answer you were still reading.
    if (input.value) {
      input.value = ''
      syncChip()
      renderOptions()
      lastEscape = Date.now()
      return
    }

    const now = Date.now()
    if (now - lastEscape < 900) {
      window.argus.hide()
      return
    }
    lastEscape = now
    setStatus('Press Esc again to close.')
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
