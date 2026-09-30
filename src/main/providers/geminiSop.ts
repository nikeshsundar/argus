import { realLineBreaks } from '../../shared/agent'
import { OVERLOAD_FALLBACKS } from '../../shared/models'
import { parseSopPlan, type SopPlan, type SopStep } from '../../shared/sop'
import { extractText, requestStep } from './geminiClient'

const PLANNER_PROMPT = `You split a user's SOP (a standard operating procedure: a long, multi-part job to do on their Windows PC) into steps for a team:
- several WRITERS, who work at the same time, each on their own piece of text, and cannot see the screen;
- one OPERATOR, who controls the PC one step at a time: opens apps and sites, reads the screen, fills forms, pastes text, sends.

Each step is one of:
- "write": produces text only - an email body, a post, a document section, a message, a translation, a summary of information that is already in the SOP or produced by an earlier step. Writers cannot see the screen or the user's accounts.
- "screen": anything done on the PC - opening apps or sites, reading what is on screen or in the user's own accounts (inbox, files, calendar), typing short values, pasting prepared text, sending.

Rules:
- Every long piece of text (more than one sentence) is its own write step, so writers produce them in parallel. Independent texts are separate write steps: five emails means five write steps.
- Short values - a subject line, a recipient address, a search term, a file name - go straight into the screen step's instruction, not into a write step.
- Set "web": true on a write step only if it needs current public facts (news, prices, recent events); that writer can search the web.
- Anything that depends on the user's own data is a screen step. If a later text is based on it, the screen step reads it and a later write step lists it in "needs".
- "needs" lists the ids of EARLIER steps whose output a step uses. A screen step that inserts a writer's text lists that write step and says exactly where it goes, e.g. "In the Gmail compose window, address it to priya@example.com, set the subject to 'Q3 update', then paste the prepared email body."
- One screen step per app or page visit - not one per click - in the order the SOP implies.
- Put write steps as early as possible, so writing starts while the operator is already working.
- Do not add sending, paying, deleting or posting that the SOP did not ask for. (The operator asks the user before any of those anyway.)
- Never invent facts about the user - names, addresses, numbers - that the SOP does not give.
- At most 12 steps. Titles under 8 words.

Reply with JSON only.`

const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    goal: { type: 'STRING', description: 'The whole SOP in one short sentence.' },
    steps: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          title: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['write', 'screen'] },
          instruction: { type: 'STRING' },
          needs: { type: 'ARRAY', items: { type: 'STRING' } },
          web: { type: 'BOOLEAN' }
        },
        required: ['id', 'title', 'kind', 'instruction']
      }
    }
  },
  required: ['goal', 'steps']
}

const WRITER_PROMPT = `You are one of several writers working in parallel on parts of a larger job. Another agent will paste exactly what you write into the right place on the user's screen.

- Output ONLY the finished text for your part, ready to paste. No preamble ("Here is..."), no notes, no quotation marks around it.
- Plain text. Separate paragraphs with a blank line. No markdown symbols (#, **, -) unless the instruction asks for them.
- For an email body: no "Subject:" or "To:" lines unless asked - just the body.
- Never invent facts about the user or anyone else: no made-up names, numbers, dates, contact details or events. If the sender's name is not given, end with a generic sign-off and no name.
- Match the length and tone the instruction asks for; otherwise keep it natural and concise.`

const NO_WEB_NOTE = `

You have no web access for this part. Do not state specific current facts (news, prices, recent events) you are not certain of - write around them rather than invent them.`

export interface SopModelOptions {
  model: string
  fallbackModels: string[]
}

/** The models SOP calls use: the Talk model first, then the usual chain. */
export function sopModels(settings: { geminiModel: string; agentModel: string }): SopModelOptions {
  return {
    model: settings.geminiModel,
    fallbackModels: [settings.agentModel, ...OVERLOAD_FALLBACKS]
  }
}

/** Splits the SOP into writer and operator steps. Null when it could not. */
export async function planSop(
  sop: string,
  key: string,
  models: SopModelOptions,
  signal: AbortSignal
): Promise<SopPlan | null> {
  const payload = await requestStep({
    apiKey: key,
    preferKey: key,
    ...models,
    // Left to think: splitting a long SOP well is the one call here where
    // deliberating pays for itself - every step after it inherits the plan.
    timeoutMs: 45_000,
    signal,
    body: {
      systemInstruction: { parts: [{ text: PLANNER_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `SOP:\n${sop}` }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: PLAN_SCHEMA
      }
    }
  })
  return parseSopPlan(extractText(payload))
}

/**
 * Writes one step's text on the given key.
 *
 * `inputs` are the outputs of the steps it needs - earlier texts, or what the
 * operator read off the screen.
 */
export async function writeSopStep(options: {
  step: SopStep
  goal: string
  inputs: { title: string; text: string }[]
  key: string
  models: SopModelOptions
  signal: AbortSignal
}): Promise<string> {
  const { step, goal, inputs, key, models, signal } = options

  const context = inputs.length
    ? `\n\nMaterial from earlier steps:\n${inputs.map((input) => `--- ${input.title} ---\n${input.text}`).join('\n\n')}`
    : ''
  const prompt = `The whole job: ${goal}\n\nYour part: ${step.instruction}${context}`

  const call = (withWeb: boolean): ReturnType<typeof requestStep> =>
    requestStep({
      apiKey: key,
      preferKey: key,
      ...models,
      timeoutMs: withWeb ? 40_000 : 25_000,
      signal,
      thinking: 'low',
      body: {
        systemInstruction: {
          parts: [{ text: WRITER_PROMPT + (step.web && !withWeb ? NO_WEB_NOTE : '') }]
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(withWeb ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: { temperature: 0.5, maxOutputTokens: 8192 }
      }
    })

  let payload
  try {
    payload = await call(step.web)
  } catch (error) {
    // Search grounding is not available on every key and model. Writing
    // without it - and being told not to invent current facts - beats
    // failing the step.
    const message = error instanceof Error ? error.message : String(error)
    if (!step.web || signal.aborted || !/\b400\b|tool|search|ground/i.test(message)) throw error
    payload = await call(false)
  }

  const text = realLineBreaks(extractText(payload)).trim()
  if (!text) throw new Error('the writer returned nothing')
  return text
}
