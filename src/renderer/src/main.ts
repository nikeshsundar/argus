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
/** The answer element currently being streamed into. */
let activeAnswer: HTMLDivElement | null = null

function setStatus(text: string, state: StatusState = 'idle'): void {
  status.textContent = text
  status.dataset['state'] = state
  status.hidden = !text
  queueMicrotask(syncHeight)
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

/** Saved conversations, fetched on demand when the history list is asked for. */
let threadOptions: Option[] = []

function showingHistory(): boolean {
  return /^\/history\b/i.test(input.value.trim())
}

async function refreshThreads(): Promise<void> {
  const threads = await window.argus.threads()
  threadOptions = threads.map((thread) => ({
    id: `thread:${thread.id}`,
    label: thread.title,
    hint: `${thread.questions} question${thread.questions === 1 ? '' : 's'} · ${relativeTime(thread.updatedAt)}`,
    insert: ''
  }))

  if (threadOptions.length === 0) {
    threadOptions = [
      { id: 'thread:none', label: 'No saved chats yet', hint: '', insert: '' }
    ]
  }
  renderOptions()
}

function relativeTime(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function renderOptions(): void {
  if (!awaitingAnswer && showingHistory()) {
    visible = threadOptions
    paintOptions()
    return
  }

  visible = awaitingAnswer ? [] : filterOptions(input.value)
  paintOptions()
}

function paintOptions(): void {
  if (highlighted >= visible.length) highlighted = visible.length - 1
  queueMicrotask(syncHeight)

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
  if (option.id.startsWith('thread:')) {
    void resumeThread(option.id.slice('thread:'.length))
    return
  }

  input.value = option.insert
  highlighted = -1
  syncChip()

  if (option.id === 'history') {
    setStatus('')
    void refreshThreads()
    input.focus()
    return
  }

  renderOptions()

  if (option.immediate) {
    submit(option.insert)
    return
  }
  input.focus()
}

/** Loads a saved conversation back into the bar and continues it. */
async function resumeThread(id: string): Promise<void> {
  if (id === 'none') return

  const turns = await window.argus.openThread(id)
  clearThread()

  for (let index = 0; index < turns.length; index += 2) {
    const question = turns[index]
    const answer = turns[index + 1]
    if (!question) continue
    const node = appendExchange(question.text)
    node.textContent = answer?.text ?? ''
  }

  input.value = ''
  highlighted = -1
  syncChip()
  renderOptions()
  setStatus('Picked up where you left off — ask anything about your current screen.')
  input.focus()
}

function submit(text: string): void {
  const trimmed = text.trim()
  if (!trimmed || awaitingAnswer) return

  // Thread management is a UI concern - it never reaches a model.
  if (/^\/history\b/i.test(trimmed)) {
    void refreshThreads()
    return
  }

  if (/^\/new\b/i.test(trimmed)) {
    void window.argus.newThread().then(() => {
      clearThread()
      input.value = ''
      renderOptions()
      setStatus('Started a new chat.')
      input.focus()
    })
    return
  }

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

// Clicking back onto the bar should let you type again without having to aim
// at the input itself - but never steal a text selection the user is making.
bar.addEventListener('mouseup', () => {
  if (awaitingAnswer) return
  if (window.getSelection()?.toString()) return
  input.focus()
})

input.addEventListener('input', () => {
  highlighted = -1
  syncChip()
  if (showingHistory() && threadOptions.length === 0) {
    void refreshThreads()
    return
  }
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

/**
 * Tells the main process how tall the bar needs to be.
 *
 * Called explicitly rather than left to the ResizeObserver alone: the window is
 * reset to its default height each time it opens, but the content re-renders to
 * the same size it was, so the observer sees no change and never fires - which
 * left the bar clipped on every open after the first.
 */
function syncHeight(): void {
  const style = getComputedStyle(bar)
  const margins = parseFloat(style.marginTop) + parseFloat(style.marginBottom)
  window.argus.resize(Math.ceil(bar.getBoundingClientRect().height + margins))
}

new ResizeObserver(syncHeight).observe(bar)

syncChip()
renderOptions()
