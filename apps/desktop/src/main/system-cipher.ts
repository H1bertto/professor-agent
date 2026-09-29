import { safeStorage } from 'electron'
import type { Cipher } from './key-vault'

/**
 * Electron's safeStorage: DPAPI on Windows, the Keychain on macOS, and the desktop keyring on
 * Linux. It works only after the app is ready.
 */
export const systemCipher: Cipher = {
  isAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    // Without a keyring, Linux falls back to a fixed password, which protects nothing.
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (encrypted) => safeStorage.decryptString(encrypted)
}
