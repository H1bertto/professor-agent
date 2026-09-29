import { describe, expect, it } from 'vitest'

import { KeyVault, type Cipher } from './key-vault'
import { fakeCipher } from './test-helpers'

describe('KeyVault', () => {
  it('seals a key into base64 that does not contain the key, and opens it again', () => {
    const vault = new KeyVault(fakeCipher())
    const sealed = vault.seal('sk-ant-secret-1234')
    expect(sealed).not.toContain('secret')
    expect(Buffer.from(sealed, 'base64').toString('base64')).toBe(sealed)
    expect(vault.open(sealed)).toBe('sk-ant-secret-1234')
  })

  it('refuses to seal when the system cannot encrypt', () => {
    const vault = new KeyVault(fakeCipher({ available: false }))
    expect(vault.available).toBe(false)
    expect(() => vault.seal('key')).toThrow()
  })

  it('gives null for keys it cannot open', () => {
    const broken: Cipher = {
      ...fakeCipher(),
      decrypt: () => {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.')
      }
    }
    expect(new KeyVault(broken).open('c2VhbGVk')).toBeNull()
    expect(new KeyVault(fakeCipher({ available: false })).open('c2VhbGVk')).toBeNull()
  })
})
