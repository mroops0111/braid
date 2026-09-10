import type { SecretStore } from '../../../src/infrastructure/secrets/SecretStore.js'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EncryptedSecretStore, readSecretKey } from '../../../src/infrastructure/secrets/EncryptedSecretStore.js'

function memoryStore(): SecretStore & { readonly raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>()
  return {
    raw,
    async read<T>(namespace: string, key: string) {
      return raw.get(`${namespace}/${key}`) as T | undefined
    },
    async write(namespace: string, key: string, value: unknown) {
      raw.set(`${namespace}/${key}`, value)
    },
    async delete(namespace: string, key: string) {
      raw.delete(`${namespace}/${key}`)
    },
  }
}

const KEY = randomBytes(32)
const OTHER_KEY = randomBytes(32)

describe('readSecretKey', () => {
  it('refuses to run without a key rather than inventing one', () => {
    expect(() => readSecretKey(undefined, 'BRAID_SECRET_KEY')).toThrow(/required/)
  })

  it('refuses a key of the wrong length', () => {
    expect(() => readSecretKey(randomBytes(16).toString('base64'), 'BRAID_SECRET_KEY')).toThrow(/32 bytes/)
  })

  it('accepts a key of the right length', () => {
    expect(readSecretKey(KEY.toString('base64'), 'BRAID_SECRET_KEY')).toEqual(KEY)
  })
})

describe('encryptedSecretStore', () => {
  it('returns what was written', async () => {
    const store = new EncryptedSecretStore({ inner: memoryStore(), key: KEY })
    await store.write('agent-credential', 'user-ada--claude-code', 'sk-secret')
    expect(await store.read('agent-credential', 'user-ada--claude-code')).toBe('sk-secret')
  })

  // Whatever reaches the disk is what an operator or a backup can read.
  it('leaves no trace of the value in what it hands the inner store', async () => {
    const inner = memoryStore()
    const store = new EncryptedSecretStore({ inner, key: KEY })
    await store.write('agent-credential', 'user-ada--claude-code', 'sk-secret')
    expect(JSON.stringify([...inner.raw.values()])).not.toContain('sk-secret')
  })

  // The path is bound in.
  // Moving a record onto another person's key is an error,
  // rather than a way to spend their account.
  it('refuses a record moved onto another path', async () => {
    const inner = memoryStore()
    const store = new EncryptedSecretStore({ inner, key: KEY })
    await store.write('agent-credential', 'user-ada--claude-code', 'sk-ada')
    inner.raw.set('agent-credential/user-bo--claude-code', inner.raw.get('agent-credential/user-ada--claude-code'))
    await expect(store.read('agent-credential', 'user-bo--claude-code')).rejects.toThrow(/could not be opened/)
  })

  it('refuses a record written under a key it does not hold', async () => {
    const inner = memoryStore()
    await new EncryptedSecretStore({ inner, key: OTHER_KEY })
      .write('agent-credential', 'user-ada--claude-code', 'sk-secret')
    const store = new EncryptedSecretStore({ inner, key: KEY })
    await expect(store.read('agent-credential', 'user-ada--claude-code')).rejects.toThrow(/could not be opened/)
  })

  // A store that fell back to plaintext would undo itself,
  // the first time a record predated encryption.
  it('refuses a plaintext record rather than reading it', async () => {
    const inner = memoryStore()
    await inner.write('agent-credential', 'user-ada--claude-code', 'sk-plain')
    const store = new EncryptedSecretStore({ inner, key: KEY })
    await expect(store.read('agent-credential', 'user-ada--claude-code')).rejects.toThrow(/not encrypted/)
  })

  it('answers nothing for a record that was never written', async () => {
    const store = new EncryptedSecretStore({ inner: memoryStore(), key: KEY })
    expect(await store.read('agent-credential', 'missing')).toBeUndefined()
  })

  describe('rotation', () => {
    it('opens a record written under the previous key', async () => {
      const inner = memoryStore()
      await new EncryptedSecretStore({ inner, key: OTHER_KEY })
        .write('agent-credential', 'user-ada--claude-code', 'sk-secret')
      const store = new EncryptedSecretStore({ inner, key: KEY, previousKey: OTHER_KEY })
      expect(await store.read('agent-credential', 'user-ada--claude-code')).toBe('sk-secret')
    })

    // Rewriting on read is what lets a rotation finish without a migration,
    // so the old key can be withdrawn once the records have been touched.
    it('rewrites it under the current key, so the old one can be dropped', async () => {
      const inner = memoryStore()
      await new EncryptedSecretStore({ inner, key: OTHER_KEY })
        .write('agent-credential', 'user-ada--claude-code', 'sk-secret')
      await new EncryptedSecretStore({ inner, key: KEY, previousKey: OTHER_KEY })
        .read('agent-credential', 'user-ada--claude-code')

      const currentOnly = new EncryptedSecretStore({ inner, key: KEY })
      expect(await currentOnly.read('agent-credential', 'user-ada--claude-code')).toBe('sk-secret')
    })
  })
})
