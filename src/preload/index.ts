import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentCursorEvent,
  AgentStepEvent,
  OpenedEvent,
  SubmitResult,
  ThreadSummary,
  Turn
} from '../shared/types'

const api = {
  /** Sends the typed request to the main process and resolves with the result. */
  submit: (text: string): Promise<SubmitResult> => ipcRenderer.invoke('argus:submit', text),

  /** Dismisses the bar. */
  hide: (): void => ipcRenderer.send('argus:hide'),

  /** Asks the main process to fit the window to this content height. */
  resize: (height: number): void => ipcRenderer.send('argus:resize', height),

  /** Past conversations, newest first. */
  threads: (): Promise<ThreadSummary[]> => ipcRenderer.invoke('argus:threads'),

  /** Resumes a saved conversation and returns its turns for display. */
  openThread: (id: string): Promise<Turn[]> => ipcRenderer.invoke('argus:open-thread', id),

  /** Files the current conversation away and starts an empty one. */
  newThread: (): Promise<void> => ipcRenderer.invoke('argus:new-thread'),

  /** Fires each time the bar is opened by the hotkey, with capture metadata. */
  onOpened: (callback: (event: OpenedEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: OpenedEvent): void =>
      callback(payload)
    ipcRenderer.on('argus:opened', listener)
    return () => ipcRenderer.off('argus:opened', listener)
  },

  /** Fires for each chunk of a streaming answer. */
  onDelta: (callback: (text: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, delta: string): void => callback(delta)
    ipcRenderer.on('argus:delta', listener)
    return () => ipcRenderer.off('argus:delta', listener)
  },

  /** Fires on every Agent Mode action - drives the bar and the overlay banner. */
  onAgentStep: (callback: (event: AgentStepEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AgentStepEvent): void =>
      callback(payload)
    ipcRenderer.on('argus:agent-step', listener)
    return () => ipcRenderer.off('argus:agent-step', listener)
  },

  /** Fires on every frame of an agent pointer glide - drives the overlay halo. */
  onAgentCursor: (callback: (event: AgentCursorEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AgentCursorEvent): void =>
      callback(payload)
    ipcRenderer.on('argus:agent-cursor', listener)
    return () => ipcRenderer.off('argus:agent-cursor', listener)
  }
}

contextBridge.exposeInMainWorld('argus', api)

export type ArgusApi = typeof api
