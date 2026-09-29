import { Menu, nativeImage, Tray } from 'electron'
import icon from '../../resources/icon.png?asset'

export interface TrayActions {
  isOverlayVisible(): boolean
  toggleOverlay(): void
  showStatus(): void
  quit(): void
}

/** The tray icon is the only way to reach the app, because the overlay has no taskbar entry. */
export function createTray(actions: TrayActions): { refresh(): void } {
  const tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))
  tray.setToolTip('Professor Agent')

  const refresh = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: actions.isOverlayVisible() ? 'Hide avatar' : 'Show avatar',
          click: () => {
            actions.toggleOverlay()
            refresh()
          }
        },
        { label: 'Status', click: actions.showStatus },
        { type: 'separator' },
        { label: 'Quit', click: actions.quit }
      ])
    )
  }

  tray.on('click', () => {
    actions.toggleOverlay()
    refresh()
  })
  refresh()
  return { refresh }
}
