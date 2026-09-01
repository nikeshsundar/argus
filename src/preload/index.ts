import { contextBridge, ipcRenderer } from 'electron'
import type { AgentStepEvent, OpenedEvent, SubmitResult } from '../shared/types'

const api = {
  /** Sends the typed request to the main process and resolves with the result. */
  submit: (text: string): Promise<SubmitResult> => ipcRenderer.invoke('argus:submit', text),

  /** Dismisses the bar. */
  hide: (): void => ipcRenderer.send('argus:hide'),

  /** Asks the main process to fit the window to this content height. */
  resize: (height: number): void => ipcRenderer.send('argus:resize', height),

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
  }
}

contextBridge.exposeInMainWorld('argus', api)

export type ArgusApi = typeof api
