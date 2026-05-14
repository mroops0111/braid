import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsSecretStore } from '../../../src/infrastructure/secrets/SecretStore.js'

describe('FsSecretStore', () => {
  let root: string
  let store: FsSecretStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'telos-secret-store-'))
    store = new FsSecretStore(root)
  })

  afterEach(async () => {
    // tmp will be cleaned by the OS
  })

  it('round-trips a value', async () => {
    await store.write('oauth-google', 'ws-1--src-a', { refreshToken: 'r123' })
    const out = await store.read<{ refreshToken: string }>('oauth-google', 'ws-1--src-a')
    expect(out).toEqual({ refreshToken: 'r123' })
  })

  it('returns undefined for missing key', async () => {
    expect(await store.read('oauth-google', 'missing')).toBeUndefined()
  })

  it('sets restrictive permissions on file (0600) and dir (0700)', async () => {
    await store.write('oauth-google', 'k', { x: 1 })
    const filePath = join(root, 'oauth-google', 'k.json')
    const fileStat = await stat(filePath)
    const dirStat = await stat(join(root, 'oauth-google'))
    // Mask off the file-type bits; compare the permission bits only.
    expect(fileStat.mode & 0o777).toBe(0o600)
    expect(dirStat.mode & 0o777).toBe(0o700)
  })

  it('sanitises namespace + key to prevent directory traversal', async () => {
    await store.write('oauth-google', '../../../etc/passwd', { value: 'pwned' })
    const out = await store.read('oauth-google', '../../../etc/passwd')
    expect(out).toEqual({ value: 'pwned' })
    // The file lives under root (sanitised), not at /etc/passwd. `.` is
    // allowed in keys (so config files can be named `client.id.json`), but
    // every `/` is rewritten to `_`.
    await expect(stat(join(root, 'oauth-google', '.._.._.._etc_passwd.json'))).resolves.toBeDefined()
  })

  it('delete removes the file; subsequent read returns undefined', async () => {
    await store.write('oauth-google', 'k', { x: 1 })
    await store.delete('oauth-google', 'k')
    expect(await store.read('oauth-google', 'k')).toBeUndefined()
  })
})
