import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import icon from '../../resources/icon.png?asset'
import type { ConversationView } from '../shared/api'
import { EMOTIONS, type AvatarChoice, type Emotion } from '../shared/avatar'
import type { AvatarOption } from './avatar-library'

export const TOGGLE_OVERLAY_SHORTCUT = 'CommandOrControl+Alt+P'
export const ASK_SHORTCUT = 'CommandOrControl+Alt+Space'

export interface TrayState {
  overlayVisible: boolean
  avatars: readonly AvatarOption[]
  currentAvatarId: string
  emotion: Emotion
  talking: boolean
  /** The talk hotkey as the student's keyboard shows it. */
  talkLabel: string
  conversation: ConversationView
}

export interface TrayActions {
  state(): TrayState
  ask(): void
  /** Starts a spoken question, or ends the one being heard. In conversation mode it pauses or
   * resumes the listening. */
  talk(): void
  toggleConversation(): void
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
    { label: `${talkLabel(state)} (${state.talkLabel})`, click: after(actions.talk) },
    {
      label: 'Conversation mode',
      type: 'checkbox',
      checked: state.conversation.on,
      click: after(actions.toggleConversation)
    },
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

function talkLabel({ conversation }: TrayState): string {
  if (!conversation.on) return 'Talk to the teacher'
  return conversation.listening ? 'Pause listening' : 'Resume listening'
}
