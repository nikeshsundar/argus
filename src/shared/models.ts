import type { ProviderName } from './types'

/**
 * The models "/aimodel" offers, and the parsing behind that command.
 *
 * Argus is bring-your-own-key, so which model answers is the user's call, not
 * ours. What this file owes them is an honest menu: what each option costs,
 * which one their key actually works with, and a default that needs no card.
 *
 * Model names churn faster than this file will. Nothing here is a whitelist -
 * "/model <id>" still sets any id the provider will accept, and a wrong one
 * comes back as a 404 that names the command to fix it. This is a starting
 * menu, not a restriction.
 */

export interface ModelChoice {
  provider: ProviderName
  /** The id sent to the provider. */
  id: string
  /** What it is called in the picker. */
  label: string
  /** The one line under it: what it costs, what it is good at. */
  note: string
}

/**
 * Ordered as shown. Gemini leads because it is the only one with a free tier
 * good enough to use Argus all day on, which is the difference between people
 * trying this and people bouncing off a paywall.
 */
export const CATALOGUE: ModelChoice[] = [
  {
    provider: 'gemini',
    id: 'gemini-3.6-flash',
    label: 'Gemini Flash',
    note: 'free tier - 20 requests a day, no card. The default.'
  },
  {
    provider: 'gemini',
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini Flash Lite',
    note: 'free tier, its own daily allowance. Faster, less careful.'
  },
  {
    provider: 'claude',
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet',
    note: 'paid. Reads cluttered screens and small text best.'
  },
  {
    provider: 'claude',
    id: 'claude-opus-5',
    label: 'Claude Opus',
    note: 'paid, the most capable and the most expensive.'
  },
  {
    provider: 'claude',
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku',
    note: 'paid, cheap and quick.'
  },
  {
    provider: 'openai',
    id: 'gpt-5',
    label: 'GPT-5',
    note: 'paid.'
  },
  {
    provider: 'openai',
    id: 'gpt-5-mini',
    label: 'GPT-5 mini',
    note: 'paid, cheaper.'
  },
  {
    provider: 'ollama',
    id: 'llama3.2-vision',
    label: 'Ollama (local)',
    note: 'free and offline, needs Ollama running. Slowest, and the least accurate.'
  }
]

/** No key, no card, no signup wall. */
export const DEFAULT_MODEL_ID = 'gemini-3.6-flash'

export function defaultChoice(): ModelChoice {
  return CATALOGUE.find((one) => one.id === DEFAULT_MODEL_ID) ?? CATALOGUE[0]!
}

export function choicesFor(provider: ProviderName): ModelChoice[] {
  return CATALOGUE.filter((one) => one.provider === provider)
}

/** Which model a bare provider name means. */
export function providerDefault(provider: ProviderName): ModelChoice | null {
  return choicesFor(provider)[0] ?? null
}

/** Every provider named in the catalogue, in the order they first appear. */
export function providers(): ProviderName[] {
  const seen: ProviderName[] = []
  for (const choice of CATALOGUE) {
    if (!seen.includes(choice.provider)) seen.push(choice.provider)
  }
  return seen
}

/** Where to get a key, said in one line. */
export function keySource(provider: ProviderName): string {
  switch (provider) {
    case 'gemini':
      return 'aistudio.google.com/apikey - free, no card'
    case 'claude':
      return 'console.anthropic.com - paid'
    case 'openai':
      return 'platform.openai.com/api-keys - paid'
    case 'ollama':
      return 'ollama.com - runs on your machine, no key'
  }
}

/** Ollama runs locally; everything else needs a key before it can answer. */
export function needsKey(provider: ProviderName): boolean {
  return provider !== 'ollama'
}

/**
 * Works out which model someone meant.
 *
 * Takes a row number, an exact id, a provider name, or enough of a label to be
 * unambiguous - because people will type "/aimodel 3", "/aimodel claude" and
 * "/aimodel sonnet" and all three are clear enough to act on.
 *
 * An ambiguous label returns null rather than a guess: picking the wrong model
 * silently is how someone ends up billed for Opus when they typed "claude".
 */
export function resolveChoice(query: string, catalogue = CATALOGUE): ModelChoice | null {
  const text = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!text) return null

  if (/^\d+$/.test(text)) {
    return catalogue[Number.parseInt(text, 10) - 1] ?? null
  }

  const exactId = catalogue.find((one) => one.id.toLowerCase() === text)
  if (exactId) return exactId

  // "claude sonnet" and "openai gpt-5" - a provider plus the rest.
  const [head, ...rest] = text.split(' ')
  if (rest.length > 0 && catalogue.some((one) => one.provider === head)) {
    const within = catalogue.filter((one) => one.provider === head)
    return resolveChoice(rest.join(' '), within)
  }

  if (catalogue.some((one) => one.provider === text)) {
    return catalogue.find((one) => one.provider === text) ?? null
  }

  const byLabel = catalogue.filter(
    (one) => one.label.toLowerCase().includes(text) || one.id.toLowerCase().includes(text)
  )
  return byLabel.length === 1 ? byLabel[0]! : null
}

/** Names close enough to what was typed to be worth offering back. */
export function suggestModels(query: string): string[] {
  const text = query.trim().toLowerCase()
  if (!text) return CATALOGUE.map((one) => one.id)
  return CATALOGUE.filter(
    (one) =>
      one.id.toLowerCase().includes(text) ||
      one.label.toLowerCase().includes(text) ||
      one.provider.includes(text)
  ).map((one) => one.id)
}

export type AiModelCommand =
  | { kind: 'none' }
  | { kind: 'list' }
  | { kind: 'pick'; query: string }

const SEP = '[\\s=:]+'
const LIST = /^\/(?:aimodel|aimodels|ai)\s*$/i
const PICK = new RegExp(`^/(?:aimodel|aimodels|ai)${SEP}(.+?)\\s*$`, 'i')

/**
 * Reads "/aimodel".
 *
 * Anchored on the whole word so it can never swallow "/model", which is the
 * older command for setting a raw id and still has to work on its own.
 */
export function parseAiModelCommand(input: string): AiModelCommand {
  const text = input.trim()
  if (LIST.test(text)) return { kind: 'list' }

  const pick = PICK.exec(text)
  if (pick) return { kind: 'pick', query: pick[1]!.trim() }

  return { kind: 'none' }
}

/**
 * The menu.
 *
 * `hasKey` decides whether a row reads as ready or as needing a key, so nobody
 * picks an option that cannot answer and gets an error a request later.
 */
export function renderCatalogue(options: {
  activeId: string
  hasKey: (provider: ProviderName) => boolean
}): string {
  const rows = CATALOGUE.map((choice, index) => {
    const active = choice.id === options.activeId
    const ready = !needsKey(choice.provider) || options.hasKey(choice.provider)
    const mark = active ? '>' : ' '
    const state = active ? 'in use' : ready ? 'ready' : 'needs a key'
    return `${mark} ${index + 1}. ${choice.label.padEnd(18)} ${state.padEnd(12)} ${choice.note}`
  })

  const missing = providers().filter(
    (provider) => needsKey(provider) && !options.hasKey(provider)
  )

  return [
    'Pick with "/aimodel <number>", or by name: "/aimodel claude sonnet".',
    '',
    ...rows,
    '',
    ...(missing.length > 0
      ? [
          'Add a key with "/key <your-key>" - it is filed by its own format, so',
          'you do not have to say which provider it belongs to:',
          ...missing.map((provider) => `  ${provider.padEnd(8)} ${keySource(provider)}`),
          ''
        ]
      : []),
    'Any other model id still works: "/model <id>".'
  ].join('\n')
}

/**
 * Models to try when the chosen one is not answering, in order.
 *
 * Not a preference list - a lifeboat. Gemini models go down individually and
 * often: measured on one ordinary afternoon, gemini-3.5-flash-lite returned
 * 503, gemini-3.6-flash hung for 25 seconds, and gemini-flash-lite-latest was
 * 503 too, while gemini-3.1-flash-lite answered in 2.3s. One alternative is
 * not enough, because the alternative can be down as well.
 *
 * Ordered by what answered when this was written, cheapest first. The aliases
 * are last and deliberately included: they follow whatever Google currently
 * considers current, so they outlive any specific id in this list.
 */
export const OVERLOAD_FALLBACKS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-flash-latest'
]
