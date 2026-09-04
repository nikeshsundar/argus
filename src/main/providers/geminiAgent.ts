import type { AgentAction } from '../../shared/agent'
import { formatAgentHistory, type AgentRunRecord } from '../../shared/agentHistory'
import { MODEL_IMAGE_MIME } from '../screenshot'
import {
  callGemini,
  describeGeminiFailure,
  dropStaleImages,
  type GeminiPart,
  type GeminiResponse
} from './geminiClient'
import { ProviderUnavailableError, type AgentSession, type ComputerUseProvider } from './types'

const SYSTEM_PROMPT = `You are Argus in Agent Mode. You are operating a real Windows desktop on the user's behalf.

Each turn you receive a fresh screenshot of the screen and must call exactly one function to make progress on the task.

Rules:
- To open a program, ALWAYS call launch_app. Never hunt for its icon on the taskbar or Start menu, and never press the Windows key and type a name: Windows Search sends the query to the web if the app has not resolved yet, which opens a browser you did not want.
- To reach a web page, call launch_app for the browser, then use type_into on its address bar with submit=true. The user is watching the pointer, so doing it on screen is the point. Fall back to open_url only if the address bar is genuinely not visible in the screenshot.
- ALWAYS type a complete address including the scheme: "https://chatgpt.com", never "chatgpt" and never "chatgpt.com". A bare word is a search term, and worse, the browser will autocomplete it from history - you will press Enter and land on some old deep link you never asked for, with no way to tell from the next screenshot why. The scheme is what makes it unambiguous.
- type_into REPLACES what is in the field. Do not clear it first, and do not include the existing text in yours. Use type_text when you genuinely want to add to what is already there.
- After any action that navigates or submits, CHECK the next screenshot is where you meant to be before carrying on. Landing on the wrong page and continuing as if you had not is worse than failing, because everything after it is aimed at the wrong screen.
- ALWAYS prefer type_into over a separate click, type_text and press_keys. Every function call is a slow round trip and the user is on a small daily quota, so three steps that could have been one is a real cost. Use type_text alone only when the field is already focused.
- The user can see every move you make. When a click and a keyboard shortcut would both work, click the thing: a visible pointer moving to a target is easier to follow, and easier to stop, than a shortcut that fires invisibly.
- Coordinates are on a 0-1000 grid for BOTH axes, where (0,0) is the top-left of the screen and (1000,1000) is the bottom-right. Look carefully at the screenshot and aim at the centre of the thing you want to hit.
- Take one small, verifiable step at a time. After each action you will see the result, so you do not need to guess ahead.
- If a click did not do what you expected, look at the new screenshot and adapt instead of repeating the same click.
- NEVER repeat an action that has already failed to achieve what you wanted. "ok" means the keystroke or click was delivered, not that it worked - if the screen is not what you expected, the action succeeded and the result is still wrong. Change your approach, or call task_done and say what is blocking you.
- Call task_done as soon as the task is complete, with a one-sentence summary of what you did.
- If the task asked you to READ, SUMMARISE, CHECK or FIND something rather than only to operate the machine, then getting to the right screen is not finishing it. Once that screen is visible, read it and put the actual answer in the task_done summary - the unread subjects, the number, the error text. Several lines is fine there; "I opened Gmail" is not an answer to "summarise my unread mail".
- If you cannot get to the information - a login wall, an empty inbox, the wrong account - call task_done and say exactly what stopped you. The user's next instruction will be read alongside your summary, so a precise one is what lets them carry on.
- If the task is impossible or unsafe, call task_done and explain why in the summary.`

const FUNCTION_DECLARATIONS = [
  {
    name: 'launch_app',
    description:
      'Open an installed program directly, without touching the Start menu. Use this for every "open <app>" request.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'The program name, e.g. "Visual Studio Code"' }
      },
      required: ['name']
    }
  },
  {
    name: 'open_url',
    description: 'Open a web page in the default browser. Use this instead of typing into a search box.',
    parameters: {
      type: 'OBJECT',
      properties: { url: { type: 'STRING', description: 'A full URL including https://' } },
      required: ['url']
    }
  },
  {
    name: 'click',
    description: 'Click at a point on screen.',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER', description: 'Horizontal position, 0-1000' },
        y: { type: 'NUMBER', description: 'Vertical position, 0-1000' },
        button: { type: 'STRING', enum: ['left', 'right'] },
        double: { type: 'BOOLEAN', description: 'True for a double click' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'type_into',
    description:
      'Click a field, REPLACE its contents with your text, and optionally press Enter - all in one step. Use this for any text box: address bars, search boxes, form fields. For a browser address bar, pass a full URL including https://.',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER', description: 'Horizontal position of the field, 0-1000.' },
        y: { type: 'NUMBER', description: 'Vertical position of the field, 0-1000.' },
        text: {
          type: 'STRING',
          description:
            'Text to put in the field, replacing what is there. For an address bar, a complete URL including https://.'
        },
        submit: { type: 'BOOLEAN', description: 'Press Enter afterwards.' }
      },
      required: ['x', 'y', 'text']
    }
  },
  {
    name: 'type_text',
    description: 'Type text at the current focus.',
    parameters: {
      type: 'OBJECT',
      properties: { text: { type: 'STRING' } },
      required: ['text']
    }
  },
  {
    name: 'press_keys',
    description:
      'Press keys together, e.g. ["super"] to open the Start menu or ["control","a"] to select all.',
    parameters: {
      type: 'OBJECT',
      properties: { keys: { type: 'ARRAY', items: { type: 'STRING' } } },
      required: ['keys']
    }
  },
  {
    name: 'scroll',
    description: 'Scroll the window under the cursor.',
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: { type: 'STRING', enum: ['up', 'down'] },
        clicks: { type: 'NUMBER', description: 'Wheel clicks, 1-10' }
      },
      required: ['direction']
    }
  },
  {
    name: 'wait',
    description: 'Wait for the screen to settle, e.g. while an app launches.',
    parameters: {
      type: 'OBJECT',
      properties: { seconds: { type: 'NUMBER' } },
      required: ['seconds']
    }
  },
  {
    name: 'task_done',
    description:
      'Finish the task. If the task asked for information, this is where the answer goes - not a description of the steps you took.',
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: {
          type: 'STRING',
          description:
            'What you did, or - when the task asked you to read, summarise, check or find something - the answer itself, read off the screen.'
        }
      },
      required: ['summary']
    }
  }
]

interface Content {
  role: 'user' | 'model'
  parts: unknown[]
}

export function createGeminiAgentProvider(options: {
  apiKey: string
  model: string
  /**
   * Tried in order when the quick model is not answering. Slower per step, but
   * a task that finishes beats one that stops halfway through operating the
   * machine - and models go down one at a time, so one alternative is not
   * enough.
   */
  fallbackModels?: string[]
}): ComputerUseProvider {
  if (!options.apiKey) {
    throw new ProviderUnavailableError('No Gemini API key set. Type "/key <your-key>" here.')
  }

  return {
    name: 'gemini',

    startTask(
      task: string,
      signal?: AbortSignal,
      installedApps: string[] = [],
      history: AgentRunRecord[] = []
    ): AgentSession {
      const contents: Content[] = []
      let pendingCall: string | null = null

      // Naming apps correctly on the first try saves a round trip, and round
      // trips are what the free tier rate-limits.
      const appList = installedApps.length
        ? `\n\nInstalled programs you can pass to launch_app:\n${installedApps.join(', ')}`
        : ''

      // What happened on the last few tasks, so a fragment can be read as the
      // continuation it is. Empty for a first task, and the block itself tells
      // the model to ignore it when the new request stands on its own.
      const recap = formatAgentHistory(history, Date.now())
      const preamble = recap ? `${recap}\n\n` : ''

      return {
        async next(screenshot: Buffer, lastResult?: string): Promise<AgentAction> {
          const image = {
            inline_data: { mime_type: MODEL_IMAGE_MIME, data: screenshot.toString('base64') }
          }

          if (contents.length === 0) {
            contents.push({
              role: 'user',
              parts: [image, { text: `${preamble}Task: ${task}${appList}` }]
            })
          } else {
            // Report the previous action's outcome, then show the new screen.
            contents.push({
              role: 'user',
              parts: [
                {
                  functionResponse: {
                    name: pendingCall ?? 'click',
                    response: { result: lastResult ?? 'done' }
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
            // A task should not fail because the quick model is busy;
            // the Talk model is slower at this but it answers.
            fallbackModels: options.fallbackModels ?? [],
            method: 'generateContent',
            signal,
            thinking: 'low',
            body: {
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents,
              tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
              toolConfig: { functionCallingConfig: { mode: 'ANY' } },
              generationConfig: { temperature: 0 }
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
            return { type: 'done', summary: text || 'The model stopped without choosing an action.' }
          }

          // Replay the model's parts exactly as returned. Gemini 3 rejects the
          // next turn if the thoughtSignature that came with a functionCall
          // isn't echoed back, so never reconstruct this from just the call.
          contents.push({ role: 'model', parts })
          pendingCall = call.name

          return toAction(call.name, call.args)
        }
      }
    }
  }
}

function toAction(name: string, args: Record<string, unknown>): AgentAction {
  const num = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

  switch (name) {
    case 'launch_app':
      return { type: 'launch', name: String(args['name'] ?? '') }
    case 'open_url':
      return { type: 'openUrl', url: String(args['url'] ?? '') }
    case 'click':
      return {
        type: 'click',
        x: num(args['x']),
        y: num(args['y']),
        button: args['button'] === 'right' ? 'right' : 'left',
        double: args['double'] === true
      }
    case 'type_into':
      return {
        type: 'typeInto',
        x: num(args['x']),
        y: num(args['y']),
        text: String(args['text'] ?? ''),
        submit: args['submit'] !== false
      }
    case 'type_text':
      return { type: 'type', text: String(args['text'] ?? '') }
    case 'press_keys':
      return {
        type: 'keys',
        keys: Array.isArray(args['keys']) ? args['keys'].map(String) : []
      }
    case 'scroll':
      return {
        type: 'scroll',
        direction: args['direction'] === 'up' ? 'up' : 'down',
        clicks: num(args['clicks'], 3)
      }
    case 'wait':
      return { type: 'wait', seconds: num(args['seconds'], 1) }
    case 'task_done':
      return { type: 'done', summary: String(args['summary'] ?? 'Task finished.') }
    default:
      return { type: 'done', summary: `Model asked for an unknown action "${name}".` }
  }
}
