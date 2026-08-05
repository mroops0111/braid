import type { Timestamp, UserId } from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { UserRegistryFile } from '../src/infrastructure/users/UserRegistryFile.js'
import { ensureServiceAccount, REACTOR_USER_ID } from '../src/serviceAccounts.js'

describe('service accounts', () => {
  let registry: UserRegistryFile

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'braid-svc-acct-'))
    registry = new UserRegistryFile(join(root, 'users.json'))
  })

  it('creates a service account as an admin and non-human', async () => {
    await ensureServiceAccount(registry, REACTOR_USER_ID, 'Reactor')
    const user = await registry.get(REACTOR_USER_ID)
    expect(user?.kind).toBe('service')
    expect(user?.serverRole).toBe('admin')
  })

  it('upgrades a pre-existing human record to a service account (idempotent)', async () => {
    await registry.create({
      id: REACTOR_USER_ID,
      displayName: 'Reactor',
      serverRole: 'user',
      createdAt: '2020-01-01T00:00:00.000Z' as Timestamp,
    })
    await ensureServiceAccount(registry, REACTOR_USER_ID, 'Reactor')
    const user = await registry.get(REACTOR_USER_ID)
    expect(user?.kind).toBe('service')
    expect(user?.serverRole).toBe('admin')
  })

  it('leaves a human record human', async () => {
    await registry.create({
      id: 'alice' as UserId,
      displayName: 'Alice',
      serverRole: 'user',
      createdAt: '2020-01-01T00:00:00.000Z' as Timestamp,
    })
    const user = await registry.get('alice' as UserId)
    expect(user?.kind).toBeUndefined()
  })
})
