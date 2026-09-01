import { app, Menu, nativeImage, Tray } from 'electron'
import iconPath from '../../resources/icon.png?asset'
import { loadSettings } from './settingsStore'

let tray: Tray | null = null

export function createTray(handlers: { onOpen: () => void }): Tray {
  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  image.setTemplateImage(false)

  tray = new Tray(image)
  tray.setToolTip('Argus')
  refreshTrayMenu(handlers)
  tray.on('click', handlers.onOpen)
  return tray
}

export function refreshTrayMenu(handlers: { onOpen: () => void }): void {
  if (!tray) return
  const { hotkey } = loadSettings()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Ask Argus (${hotkey})`, click: handlers.onOpen },
      { type: 'separator' },
      { label: `Argus v${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
}
