import { parseTodos } from '../../shared/todos'
import { callGemini, extractText } from './geminiClient'

const PROMPT = `Break the user's computer task into a short to-do list: the milestones a person watching would recognise, not individual clicks.

- 2 to 6 items, in order. Just 1 if the task is a single action.
- Each item 2-6 words, starting with a verb.
- Only what the task asks for - no extra checking or confirming steps.

Example - "open youtube and play mr beast's latest video":
{"todos": ["Open YouTube", "Search for MrBeast", "Find his latest video", "Open the video", "Play it"]}

Reply with JSON only.`

const SCHEMA = {
  type: 'OBJECT',
  properties: { todos: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['todos']
}

/**
 * Plans a run's to-do list. Null when it could not - no key, no quota, too
 * slow - and the run goes ahead without one: a list is there to show
 * progress, never a reason for the task not to start.
 *
 * On the lite model with a short deadline and no retries, because the user
 * is waiting on it before anything moves - and lite's free quota is its own.
 */
export async function planTodos(options: {
  task: string
  apiKey: string
  fallbackModels: string[]
  signal: AbortSignal
}): Promise<string[] | null> {
  try {
    const response = await callGemini({
      apiKey: options.apiKey,
      model: 'gemini-2.5-flash-lite',
      fallbackModels: options.fallbackModels,
      method: 'generateContent',
      timeoutMs: 8_000,
      signal: options.signal,
      thinking: 'low',
      body: {
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: options.task }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 400,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA
        }
      }
    })
    if (!response.ok) return null
    return parseTodos(extractText(await response.json()))
  } catch {
    return null
  }
}
