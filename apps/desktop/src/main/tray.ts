import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import icon from '../../resources/icon.png?asset'
import { EMOTIONS, type AvatarChoice, type Emotion } from '../shared/avatar'
import type { AvatarOption } from './avatar-library'

export const TOGGLE_OVERLAY_SHORTCUT = 'CommandOrControl+Alt+P'
export const ASK_SHORTCUT = 'CommandOrControl+Alt+Space'
/**
 * The key below Esc, which types ' on the Brazilian ABNT2 layout and ` on the US layout.
 * Electron names keys by the US layout.
 */
export const TALK_SHORTCUT = 'CommandOrControl+Shift+`'

export interface TrayState {
  overlayVisible: boolean
  avatars: readonly AvatarOption[]
  currentAvatarId: string
  emotion: Emotion
  talking: boolean
}

export interface TrayActions {
  state(): TrayState
  ask(): void
  /** Starts a spoken question, or ends the one being heard. */
  talk(): void
  toggleOverlay(): void
  selectAvatar(choice: AvatarChoice): void
  importVrm(): void
  importPngTuber(): void
  previewEmotion(emotion: Emotion): void
  previewTalking(talking: boolean): void
  resetPosition(): void
  showSettings(): void
  quit(): void
}

/** The tray icon is the only way to reach the app, because the overlay has no taskbar entry. */
export function createTray(actions: TrayActions): { refresh(): void } {
  const tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))
  tray.setToolTip('Professor Agent')

  const refresh = (): void => tray.setContextMenu(Menu.buildFromTemplate(menu(actions, refresh)))
  tray.on('click', () => {
    actions.toggleOverlay()
    refresh()
  })
  refresh()
  return { refresh }
}

function menu(actions: TrayActions, refresh: () => void): MenuItemConstructorOptions[] {
  const state = actions.state()
  const after =
    (action: () => void): (() => void) =>
    () => {
      action()
      refresh()
    }

  const avatarItems: MenuItemConstructorOptions[] = state.avatars.map((avatar) => ({
    label: `${avatar.name} (${avatar.kind === 'vrm' ? '3D' : '2D'})`,
    type: 'radio',
    checked: avatar.id === state.currentAvatarId,
    click: after(() => actions.selectAvatar({ kind: avatar.kind, id: avatar.id }))
  }))

  return [
    { label: 'Ask a question...', accelerator: ASK_SHORTCUT, click: actions.ask },
    { label: 'Talk to the teacher', accelerator: TALK_SHORTCUT, click: actions.talk },
    {
      label: state.overlayVisible ? 'Hide avatar' : 'Show avatar',
      accelerator: TOGGLE_OVERLAY_SHORTCUT,
      click: after(actions.toggleOverlay)
    },
    {
      label: 'Avatar',
      submenu: [
        ...avatarItems,
        { type: 'separator' },
        { label: 'Import a VRM file...', click: actions.importVrm },
        { label: 'Import a PNGTuber folder...', click: actions.importPngTuber }
      ]
    },
    {
      label: 'Try an expression',
      submenu: EMOTIONS.map((emotion) => ({
        label: emotion[0].toUpperCase() + emotion.slice(1),
        type: 'radio' as const,
        checked: emotion === state.emotion,
        click: after(() => actions.previewEmotion(emotion))
      }))
    },
    {
      label: 'Try talking',
      type: 'checkbox',
      checked: state.talking,
      click: after(() => actions.previewTalking(!state.talking))
    },
    { label: 'Reset position', click: actions.resetPosition },
    { type: 'separator' },
    { label: 'Settings and credits...', click: actions.showSettings },
    { label: 'Quit', click: actions.quit }
  ]
}
