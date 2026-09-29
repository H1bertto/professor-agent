/** Encrypts short secrets with the operating system. See system-cipher.ts for the real one. */
export interface Cipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(encrypted: Buffer): string
}

/** Turns the API key into text that is safe to keep in the settings file, and back. */
export class KeyVault {
  constructor(private readonly cipher: Cipher) {}

  get available(): boolean {
    return this.cipher.isAvailable()
  }

  /** The encrypted key in base64. Throws when the system cannot encrypt. */
  seal(key: string): string {
    if (!this.available) throw new Error('This computer cannot encrypt the API key.')
    return this.cipher.encrypt(key).toString('base64')
  }

  /**
   * The key, or `null` when it cannot be decrypted, for example after the settings file moved to
   * another computer or user account.
   */
  open(sealed: string): string | null {
    if (!this.available) return null
    try {
      return this.cipher.decrypt(Buffer.from(sealed, 'base64'))
    } catch {
      return null
    }
  }
}
