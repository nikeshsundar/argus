import { groundingSources } from '../../shared/recipes'
import { configuredKeys } from '../geminiKeys'
import { loadSettings } from '../settingsStore'
import { extractText, requestStep } from './geminiClient'
import { sopModels } from './geminiSop'

/**
 * Agent Mode's web_search: facts from Google Search, with their sources.
 *
 * The agent used to have no way to learn anything that was not on screen, so a
 * task like "a sheet of the top 10 companies and their revenue" was filled from
 * the model's memory - plausible numbers, confidently wrong. This is where it
 * looks things up instead, and every rule below is about refusing to guess.
 */

/** The answer handed back to the agent is for typing, so it only needs the facts. */
const MAX_CHARS = 4000

function researchPrompt(query: string, today: string): string {
  return `Search Google and answer this for an assistant that will type your answer into the user's documents.
Question: ${query}
Today is ${today}.

- Use only facts you found in the search results. Never estimate, and never fill a gap from memory: write "not found" for anything you could not find.
- Give exact figures with their unit, currency and period, e.g. "Revenue: 255324 (₹ crore, FY2024-25)".
- For a list or a table, one item per line, in the order asked for.
- Plain text. No preamble, no commentary.`
}

/**
 * Runs one lookup. Always resolves with text for the agent - including when
 * nothing could be found, which it is told to report rather than paper over.
 * Rejects only when the run was stopped.
 */
export async function webSearch(query: string, signal: AbortSignal): Promise<string> {
  const key = configuredKeys()[0]
  if (!key || !query.trim()) {
    return 'web_search could not run. Do NOT invent the facts: leave them out and say in task_done that they could not be looked up.'
  }

  const today = new Date().toISOString().slice(0, 10)
  try {
    const payload = await requestStep({
      apiKey: key,
      preferKey: key,
      ...sopModels(loadSettings()),
      timeoutMs: 45_000,
      signal,
      thinking: 'low',
      body: {
        contents: [{ role: 'user', parts: [{ text: researchPrompt(query, today) }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0, maxOutputTokens: 4096 }
      }
    })

    const answer = extractText(payload).slice(0, MAX_CHARS)
    const sources = groundingSources(payload)
    if (!answer) {
      return `web_search found nothing for "${query}". Do NOT invent it: leave it out and say so in task_done.`
    }
    if (sources.length === 0) {
      // Google decides whether to search; an answer it did not ground is the
      // model's memory again, and must not be passed off as looked up.
      return (
        `web_search answered WITHOUT any web sources, so this is UNVERIFIED:\n${answer}\n\n` +
        'Do not present these as facts. Either leave them out, or label them unverified on screen and in task_done.'
      )
    }
    return `web_search results for "${query}" (sources: ${sources.join(', ')}):\n${answer}`
  } catch (error) {
    if (signal.aborted) throw error
    const why = error instanceof Error ? error.message : String(error)
    return `web_search failed (${why.slice(0, 160)}). Do NOT invent the facts: leave them out and say in task_done that they could not be looked up.`
  }
}
