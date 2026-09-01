import { contextBridge, ipcRenderer } from 'electron'
import type { OpenedEvent, SubmitResult } from '../shared/types'

const api = {
  /** Sends the typed request to the main process and resolves with the result. */
  submit: (text: string): Promise<SubmitResult> => ipcRenderer.invoke('argus:submit', text),

  /** Dismisses the bar. */
  hide: (): void => ipcRenderer.send('argus:hide'),

  /** Fires each time the bar is opened by the hotkey, with capture metadata. */
  onOpened: (callback: (event: OpenedEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: OpenedEvent): void =>
      callback(payload)
    ipcRenderer.on('argus:opened', listener)
    return () => ipcRenderer.off('argus:opened', listener)
  }
}

contextBridge.exposeInMainWorld('argus', api)

export type ArgusApi = typeof api
