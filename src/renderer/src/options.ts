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
    id: 'provider',
    label: 'Switch provider',
    hint: '/provider claude · gemini',
    insert: '/provider '
  },
  {
    id: 'model',
    label: 'Change model',
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
  return OPTIONS.filter(
    (option) => option.id.startsWith(term) || option.label.toLowerCase().includes(term)
  )
}
