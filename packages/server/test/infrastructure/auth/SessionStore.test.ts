import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UserId } from '@braidhq/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { FsSessionStore } from '../../../src/infrastructure/auth/SessionStore.js'

const alice = UserId.parse('user-alice')
const bob = UserId.parse('user-bob')

describe('FsSessionStore', () => {
  let filePath: string
  let store: FsSessionStore

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'braid-session-store-'))
    filePath = join(root, 'sessions.json')
    store = new FsSessionStore(filePath)
  })

  it('issues a token that resolves back to its user', async () => {
    const issued = await store.issue(alice)
    expect(issued.userId).toBe(alice)
    expect(issued.token.length).toBeGreaterThan(0)
    const resolved = await store.resolve(issued.token)
    expect(resolved).toEqual({ userId: alice })
  })

  it('issues a distinct token each time', async () => {
    const a = await store.issue(alice)
    const b = await store.issue(alice)
    expect(a.token).not.toBe(b.token)
  })

  it('persists only the hash, never the plaintext token', async () => {
    const { token } = await store.issue(alice)
    const raw = await readFile(filePath, 'utf-8')
    expect(raw).not.toContain(token)
    const { sessions } = JSON.parse(raw)
    expect(sessions[0].tokenHash).toHaveLength(64)
    expect(sessions[0]).not.toHaveProperty('token')
  })

  it('resolve returns null for an unknown or empty token', async () => {
    expect(await store.resolve('nope')).toBeNull()
    expect(await store.resolve('')).toBeNull()
  })

  it('resolve on a fresh store with no file returns null', async () => {
    expect(await store.resolve('anything')).toBeNull()
  })

  it('resolve stamps lastUsedAt as a side effect', async () => {
    const { token } = await store.issue(alice)
    await store.resolve(token)
    const { sessions } = JSON.parse(await readFile(filePath, 'utf-8'))
    expect(sessions[0].lastUsedAt).toBeDefined()
  })

  it('carries expiresAt through issue and resolve when a ttl is given', async () => {
    const issued = await store.issue(alice, { ttlSeconds: 3600 })
    expect(issued.expiresAt).toBeDefined()
    const resolved = await store.resolve(issued.token)
    expect(resolved?.expiresAt).toBe(issued.expiresAt)
  })

  it('resolve returns null once the token has expired', async () => {
    // A negative ttl stamps expiresAt in the past, no waiting needed.
    const { token } = await store.issue(alice, { ttlSeconds: -1 })
    expect(await store.resolve(token)).toBeNull()
  })

  it('revoke invalidates a single token', async () => {
    const { token } = await store.issue(alice)
    await store.revoke(token)
    expect(await store.resolve(token)).toBeNull()
  })

  it('revoke on an unknown token is a no-op', async () => {
    const { token } = await store.issue(alice)
    await store.revoke('never-issued')
    expect(await store.resolve(token)).toEqual({ userId: alice })
  })

  it('revokeAllForUser drops that user sessions and leaves others', async () => {
    const a1 = await store.issue(alice)
    const a2 = await store.issue(alice)
    const b1 = await store.issue(bob)
    await store.revokeAllForUser(alice)
    expect(await store.resolve(a1.token)).toBeNull()
    expect(await store.resolve(a2.token)).toBeNull()
    expect(await store.resolve(b1.token)).toEqual({ userId: bob })
  })

  it('revokeAllForUser with no matching sessions is a no-op', async () => {
    const b1 = await store.issue(bob)
    await store.revokeAllForUser(alice)
    expect(await store.resolve(b1.token)).toEqual({ userId: bob })
  })
})
