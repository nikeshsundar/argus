import { app, Menu, nativeImage, Tray } from 'electron'
import iconPath from '../../resources/icon.png?asset'
import { shortStatus } from '../shared/recall'
import { memoryStatus } from './screenMemory'
import { loadSettings } from './settingsStore'

export interface TrayHandlers {
  onOpen: () => void
  onToggleMemory: () => void
  onPurgeMemory: () => void
}

let tray: Tray | null = null

export function createTray(handlers: TrayHandlers): Tray {
  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  image.setTemplateImage(false)

  tray = new Tray(image)
  refreshTrayMenu(handlers)
  tray.on('click', handlers.onOpen)
  return tray
}

export function refreshTrayMenu(handlers: TrayHandlers): void {
  if (!tray) return

  const { hotkey } = loadSettings()
  const memory = memoryStatus()

  // The tooltip is the one place the recorder's state is visible without
  // opening anything, so it says which of the two states it is in every time -
  // not only the interesting one.
  tray.setToolTip(`Argus — ${shortStatus(memory)}`)

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Ask Argus (${hotkey})`, click: handlers.onOpen },
      { type: 'separator' },
      {
        label: memory.recording
          ? `Screen memory: recording the last ${Math.round(memory.windowMs / 60_000)} min`
          : 'Screen memory: off',
        type: 'checkbox',
        checked: memory.recording,
        click: handlers.onToggleMemory
      },
      {
        label:
          memory.frames === 0
            ? 'Nothing remembered'
            : `Forget the ${memory.frames} moments held in RAM`,
        enabled: memory.frames > 0,
        click: handlers.onPurgeMemory
      },
      { type: 'separator' },
      { label: `Argus v${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
}
