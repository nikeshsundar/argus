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
    id: 'talk',
    label: 'Ask about this screen',
    hint: 'Just type your question',
    insert: ''
  },
  {
    id: 'agent',
    label: 'Agent — take control of my PC',
    hint: 'agent <task>',
    insert: 'agent '
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
    hint: '/hotkey Super+`',
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
