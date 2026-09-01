/** One row in the command palette shown under the input. */
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
    id: 'screen',
    label: "What's on my screen?",
    hint: 'Talk',
    insert: "What's on my screen right now?",
    immediate: true
  },
  {
    id: 'explain',
    label: 'Explain this error',
    hint: 'Talk',
    insert: 'Explain the error shown on my screen and how to fix it.',
    immediate: true
  },
  {
    id: 'summarize',
    label: 'Summarise this page',
    hint: 'Talk',
    insert: 'Summarise what is on my screen in a few short lines.',
    immediate: true
  },
  {
    id: 'agent',
    label: 'Agent — take control of my PC',
    hint: 'then describe the task',
    insert: 'agent '
  },
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
 * Empty input lists everything, "/" filters the command rows, and anything else
 * is treated as a question - the list gets out of the way.
 */
export function filterOptions(value: string): Option[] {
  const text = value.trim().toLowerCase()
  if (!text) return OPTIONS

  if (text.startsWith('/')) {
    const term = text.slice(1)
    return OPTIONS.filter(
      (option) =>
        option.insert.startsWith('/') &&
        (option.id.startsWith(term) || option.label.toLowerCase().includes(term))
    )
  }

  if (text.startsWith('agent')) {
    return OPTIONS.filter((option) => option.id === 'agent')
  }

  return []
}
