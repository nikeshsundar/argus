/**
 * One row in the command palette.
 *
 * The palette is only reachable by typing "/" - the bar itself stays a bare
 * input, so nothing floats over the screen the user is asking about.
 */
export interface Option {
  id: string
  label: string
  hint: string
  /** Text placed in the input when chosen. */
  insert: string
  /** Submit immediately instead of waiting for an argument. */
  immediate?: boolean
}

export const OPTIONS: Option[] = [
  {
    id: 'history',
    label: 'Past chats',
    hint: '/history',
    insert: '/history'
  },
  {
    id: 'new',
    label: 'Start a new chat',
    hint: '/new',
    insert: '/new',
    immediate: true
  },
  {
    id: 'aimodel',
    label: 'Pick the AI model',
    hint: '/aimodel  gemini free · claude · gpt',
    insert: '/aimodel',
    immediate: true
  },
  {
    id: 'model',
    label: 'Set a model id directly',
    hint: '/model <model-id>',
    insert: '/model '
  },
  {
    id: 'key',
    label: 'Set API key',
    hint: '/key <api-key>',
    insert: '/key '
  },
  {
    id: 'keys',
    label: 'API keys in rotation',
    hint: '/keys',
    insert: '/keys',
    immediate: true
  },
  {
    id: 'workflows',
    label: 'Saved workflows',
    hint: '/workflows',
    insert: '/workflows',
    immediate: true
  },
  {
    id: 'save',
    label: 'Save the last Agent run',
    hint: '/save <name>',
    insert: '/save '
  },
  {
    id: 'run',
    label: 'Replay a workflow',
    hint: '/run <name> · no model call',
    insert: '/run '
  },
  {
    id: 'recall',
    label: 'Ask about something already gone',
    hint: '/recall <question>',
    insert: '/recall '
  },
  {
    id: 'memory',
    label: 'Screen memory',
    hint: '/memory on · off · purge',
    insert: '/memory',
    immediate: true
  },
  {
    id: 'hotkey',
    label: 'Rebind hotkey',
    hint: '/hotkey Alt+`',
    insert: '/hotkey '
  },
  {
    id: 'cursor',
    label: 'Pointer speed',
    hint: '/cursor natural · demo · instant',
    insert: '/cursor '
  },
  {
    id: 'help',
    label: 'Show all commands',
    hint: '/help',
    insert: '/help',
    immediate: true
  }
]

/**
 * Which options to show for the current input.
 *
 * Nothing, unless the input starts with "/". An empty bar is the default state:
 * the user came here to ask about what is behind the window, so the window
 * covers as little of it as possible.
 */
export function filterOptions(value: string): Option[] {
  const text = value.trim().toLowerCase()
  if (!text.startsWith('/')) return []

  const term = text.slice(1)
  // Name matches rank above label matches, and the palette's first row is the
  // one Enter picks. Without this, typing "/save" in full offers "Saved
  // workflows" first, because its label happens to contain the word - so the
  // exact command someone typed loses to a near miss.
  const byName = OPTIONS.filter((option) => option.id.startsWith(term))
  const byLabel = OPTIONS.filter(
    (option) => !option.id.startsWith(term) && option.label.toLowerCase().includes(term)
  )
  return [...byName, ...byLabel]
}
