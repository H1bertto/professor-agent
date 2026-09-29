import { app } from 'electron'
import { join } from 'path'
import type { AvatarRoots } from './avatar-protocol'

/** `resources/` in development, or the unpacked copy inside the installed app. */
function resourcesDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    : join(app.getAppPath(), 'resources')
}

export function avatarRoots(): AvatarRoots {
  return {
    builtin: join(resourcesDirectory(), 'avatars'),
    user: join(app.getPath('userData'), 'avatars')
  }
}

export function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}
