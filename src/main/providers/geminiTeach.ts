import type { TeachAction, TeachStep } from '../../shared/teach'
import { MODEL_IMAGE_MIME } from '../screenshot'
import {
  callGemini,
  describeGeminiFailure,
  dropStaleImages,
  type GeminiPart,
  type GeminiResponse
} from './geminiClient'
import { ProviderUnavailableError } from './types'

const SYSTEM_PROMPT = `You are Argus in Teach Mode. A person wants to learn how to do something on their own Windows PC, and you are standing behind them pointing at the screen.

You never touch their mouse or keyboard. You point at one thing at a time and they do it themselves. Between your turns they will have actually clicked or typed something, and you will see the result in the next screenshot.

Each turn you receive a fresh screenshot and must call exactly one function.

Rules:
- Call point_at for the next single thing they should do. One control per step - never bundle "click here then click there".
- Coordinates are on a 0-1000 grid for BOTH axes, (0,0) top-left and (1000,1000) bottom-right. Aim at the centre of the control. A caption is drawn just below this point, so point at the control itself, not at empty space.
- title is a short imperative naming the control they can see: "Click the + in the top right". Under 60 characters.
- detail is one or two sentences on what this does and why it is the right next step. This is the part they are here for - a person who only wanted the outcome would have asked the agent to do it. Never restate the title.
- action is "click" for something to click, "type" for something to type into, "look" for a step that is only worth reading.
- Look at the screenshot before every step. They may have clicked the wrong thing, gone back, or already done what you were about to say. Adapt to the screen in front of you rather than following a script.
- If the last step clearly did not work, point at the right thing again and use detail to say what went wrong, gently.
- If what they asked for is not reachable from this screen, use the first steps to get there - open the browser, navigate to the site - one step at a time.
- Call lesson_done the moment the goal on screen is achieved, with a one-sentence summary of what they learned.
- Never guess at UI you cannot see in the screenshot.`

const FUNCTION_DECLARATIONS = [
  {
    name: 'point_at',
    description: 'Point the ghost cursor at one control and explain the step.',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER', description: 'Horizontal position, 0-1000.' },
        y: { type: 'NUMBER', description: 'Vertical position, 0-1000.' },
        title: { type: 'STRING', description: 'Short imperative naming the control.' },
        detail: { type: 'STRING', description: 'One or two sentences: what this does and why.' },
        action: {
          type: 'STRING',
          enum: ['click', 'type', 'look'],
          description: 'What the learner does here.'
        }
      },
      required: ['x', 'y', 'title', 'detail', 'action']
    }
  },
  {
    name: 'lesson_done',
    description: 'The goal has been reached. Ends the lesson.',
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING', description: 'One sentence on what they learned.' }
      },
      required: ['summary']
    }
  }
]

interface Content {
  role: 'user' | 'model'
  /**
   * Loose on purpose: outgoing parts include images and functionResponses,
   * which GeminiPart (a response shape) does not describe. Matches how the
   * agent provider builds its history.
   */
  parts: unknown[]
}

/** A step, or the end of the lesson. */
export type TeachTurn =
  | { kind: 'step'; step: Omit<TeachStep, 'index'> }
  | { kind: 'done'; summary: string }

export interface TeachSession {
  /**
   * Decides the next step from the current screen.
   * `lastResult` describes what the learner just did, so the model can tell
   * progress from a wrong turn.
   */
  next(screenshot: Buffer, lastResult?: string): Promise<TeachTurn>
}

export interface TeachProviderOptions {
  apiKey: string
  model: string
}

const ACTIONS: TeachAction[] = ['click', 'type', 'look']

function toStep(args: Record<string, unknown>): Omit<TeachStep, 'index'> {
  const action = String(args['action'] ?? 'click') as TeachAction
  return {
    x: Number(args['x'] ?? 500),
    y: Number(args['y'] ?? 500),
    title: String(args['title'] ?? 'Next step'),
    detail: String(args['detail'] ?? ''),
    action: ACTIONS.includes(action) ? action : 'click'
  }
}

export function createGeminiTeachProvider(options: TeachProviderOptions): {
  startLesson(topic: string, signal?: AbortSignal): TeachSession
} {
  if (!options.apiKey) {
    throw new ProviderUnavailableError('No Gemini API key set. Type "/key <your-key>" here.')
  }

  return {
    startLesson(topic: string, signal?: AbortSignal): TeachSession {
      const contents: Content[] = []
      let pendingCall: string | null = null

      return {
        async next(screenshot: Buffer, lastResult?: string): Promise<TeachTurn> {
          const image = {
            inline_data: { mime_type: MODEL_IMAGE_MIME, data: screenshot.toString('base64') }
          }

          if (contents.length === 0) {
            contents.push({
              role: 'user',
              parts: [image, { text: `They want to learn: ${topic}` }]
            })
          } else {
            contents.push({
              role: 'user',
              parts: [
                {
                  functionResponse: {
                    name: pendingCall ?? 'point_at',
                    response: { result: lastResult ?? 'they moved on' }
                  }
                },
                image
              ]
            })
          }

          // Only the newest screen matters for the next decision, and resending
          // the older ones grew every request and burned the rate limit.
          dropStaleImages(contents)

          const response = await callGemini({
            apiKey: options.apiKey,
            model: options.model,
            method: 'generateContent',
            signal,
            thinking: 'low',
            body: {
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents,
              tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
              toolConfig: { functionCallingConfig: { mode: 'ANY' } },
              generationConfig: { temperature: 0.2 }
            }
          })

          if (!response.ok) throw new Error(await describeGeminiFailure(response, options.model))

          const payload = (await response.json()) as GeminiResponse
          if (payload.error?.message) throw new Error(`Gemini: ${payload.error.message}`)

          const parts = payload.candidates?.[0]?.content?.parts ?? []
          const call = parts.find((part: GeminiPart) => part.functionCall)?.functionCall

          if (!call) {
            const text = parts
              .filter((part) => !part.thought && part.text)
              .map((part) => part.text)
              .join('')
              .trim()
            return { kind: 'done', summary: text || 'The lesson ended without a next step.' }
          }

          // Replay the model's parts verbatim: Gemini 3 rejects the next turn
          // if the thoughtSignature issued with a functionCall is not echoed.
          contents.push({ role: 'model', parts })
          pendingCall = call.name

          if (call.name === 'lesson_done') {
            return { kind: 'done', summary: String(call.args?.['summary'] ?? 'Lesson complete.') }
          }

          return { kind: 'step', step: toStep(call.args ?? {}) }
        }
      }
    }
  }
}
