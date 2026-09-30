import { MODEL_IMAGE_MIME } from '../screenshot'
import { extractText, requestStep, STEP_TIMEOUT_MS } from './geminiClient'
import { parseVerdict, type Verdict } from '../../shared/verify'

/**
 * A second pair of eyes on "done".
 *
 * The agent is the worst judge of its own work: it decided what to do, it
 * expects it to have worked, and a model that has been told "ok" after every
 * step will read a Google results page for "nivonto.tech" as nivonto.tech.
 * This checker has none of that history. It gets the task, the claim and the
 * final screen, and one question: does the screen prove it?
 *
 * Run on the lite model on purpose - free-tier quota is counted per model, so
 * checking does not eat into what the agent itself has left.
 */
const PROMPT = `You are a strict checker for a computer-use agent. You are given the user's task, the agent's claim that it finished, the proof it quoted, and a screenshot of the screen as it is now.

Decide whether the screenshot PROVES the task is complete.

- Judge only by what is visible in the screenshot. The agent's words are claims, not facts.
- Opening a site means the browser shows that site - a search results page ABOUT the site is not the site.
- Sending a message means a sent confirmation, or the message in a Sent view - an open draft is not sent.
- Writing something means the text is visible in the right place, complete and not garbled.
- Finding or summarising information means the answer in the claim matches what is on screen.
- If any claim in the summary is not supported by the screenshot, it is not complete.
- Be fair: if the screen clearly shows the task done, say so even if the wording is loose.

Reply with JSON only: {"complete": true or false, "problem": "if not complete, one short sentence saying exactly what is wrong or missing on screen"}`

export async function verifyCompletion(options: {
  apiKey: string
  model: string
  fallbackModels: string[]
  task: string
  summary: string
  evidence?: string
  screenshot: Buffer
  signal?: AbortSignal
}): Promise<Verdict> {
  const payload = await requestStep({
    apiKey: options.apiKey,
    model: options.model,
    fallbackModels: options.fallbackModels,
    timeoutMs: STEP_TIMEOUT_MS,
    signal: options.signal,
    thinking: 'low',
    body: {
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [
        {
          role: 'user',
          parts: [
            {
              inline_data: {
                mime_type: MODEL_IMAGE_MIME,
                data: options.screenshot.toString('base64')
              }
            },
            {
              text: [
                `Task: ${options.task}`,
                `Agent's claim: ${options.summary}`,
                `Proof it quoted: ${options.evidence?.trim() || '(none given)'}`
              ].join('\n')
            }
          ]
        }
      ],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    }
  })
  return parseVerdict(extractText(payload))
}
