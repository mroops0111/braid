import type { AbsolutePath, Timestamp, UserId } from '@braidhq/schema'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ValidationError } from '@braidhq/core'
import { SkillId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { WorkspaceRegistryFile } from '../../../src/infrastructure/fs/WorkspaceRegistryFile.js'

async function makeRegistryFile(): Promise<{ filePath: string, registry: WorkspaceRegistryFile }> {
  const dir = await mkdtemp(join(tmpdir(), 'braid-registry-'))
  const filePath = join(dir, 'workspaces.json')
  return { filePath, registry: new WorkspaceRegistryFile(filePath) }
}

describe('WorkspaceRegistryFile', () => {
  it('list returns empty array when file does not exist yet', async () => {
    const { registry } = await makeRegistryFile()
    expect(await registry.list()).toEqual([])
  })

  it('add then list round-trips paths', async () => {
    const { registry } = await makeRegistryFile()
    await registry.add('/abs/ws-1' as AbsolutePath)
    await registry.add('/abs/ws-2' as AbsolutePath)
    expect(await registry.list()).toEqual(['/abs/ws-1', '/abs/ws-2'])
  })

  it('add is idempotent (duplicate path is no-op)', async () => {
    const { registry } = await makeRegistryFile()
    await registry.add('/abs/ws-1' as AbsolutePath)
    await registry.add('/abs/ws-1' as AbsolutePath)
    expect(await registry.list()).toEqual(['/abs/ws-1'])
  })

  it('remove deletes the matching path', async () => {
    const { registry } = await makeRegistryFile()
    await registry.add('/abs/ws-1' as AbsolutePath)
    await registry.add('/abs/ws-2' as AbsolutePath)
    await registry.remove('/abs/ws-1' as AbsolutePath)
    expect(await registry.list()).toEqual(['/abs/ws-2'])
  })

  it('remove is a no-op when path not present', async () => {
    const { registry } = await makeRegistryFile()
    await registry.remove('/abs/never-added' as AbsolutePath)
    expect(await registry.list()).toEqual([])
  })

  it('persists across instances (cold start re-reads file)', async () => {
    const { filePath, registry } = await makeRegistryFile()
    await registry.add('/abs/ws-1' as AbsolutePath)

    const fresh = new WorkspaceRegistryFile(filePath)
    expect(await fresh.list()).toEqual(['/abs/ws-1'])
  })

  it('writes a parent directory that does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'braid-registry-'))
    const filePath = join(dir, 'nested', 'sub', 'workspaces.json')
    const registry = new WorkspaceRegistryFile(filePath)
    await registry.add('/abs/ws-1' as AbsolutePath)
    const raw = await readFile(filePath, 'utf-8')
    expect(JSON.parse(raw).workspaces).toHaveLength(1)
  })

  it('throws ValidationError when file content is malformed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'braid-registry-'))
    const filePath = join(dir, 'workspaces.json')
    await writeFile(filePath, JSON.stringify({ workspaces: [{ wrongShape: true }] }), 'utf-8')
    const registry = new WorkspaceRegistryFile(filePath)
    await expect(registry.list()).rejects.toThrow(ValidationError)
  })
})

describe('WorkspaceRegistryFile members', () => {
  const rootPath = '/abs/ws-1' as AbsolutePath
  const TEST_TIMESTAMP = '2026-01-01T00:00:00.000Z' as Timestamp

  async function makeSeededRegistry(): Promise<{ filePath: string, registry: WorkspaceRegistryFile }> {
    const { filePath, registry } = await makeRegistryFile()
    await registry.add(rootPath)
    return { filePath, registry }
  }

  it('skillOverrides survive a cold reload of the registry file', async () => {
    const { filePath, registry } = await makeSeededRegistry()
    await registry.addMember(rootPath, {
      userId: 'usr-1' as UserId,
      role: 'guest',
      joinedAt: TEST_TIMESTAMP,
      skillOverrides: { [SkillId.parse('braid-ask')]: 'allow', [SkillId.parse('braid-extract')]: 'deny' },
    })

    const cold = new WorkspaceRegistryFile(filePath)
    const member = await cold.getMember(rootPath, 'usr-1' as UserId)

    expect(member?.skillOverrides).toEqual({ [SkillId.parse('braid-ask')]: 'allow', [SkillId.parse('braid-extract')]: 'deny' })
  })

  it('updateMember can merge a fresh skillOverride into an existing member', async () => {
    const { registry } = await makeSeededRegistry()
    await registry.addMember(rootPath, {
      userId: 'usr-1' as UserId,
      role: 'guest',
      joinedAt: TEST_TIMESTAMP,
    })

    const updated = await registry.updateMember(rootPath, 'usr-1' as UserId, {
      skillOverrides: { [SkillId.parse('braid-ask')]: 'allow' },
    })

    expect(updated.skillOverrides).toEqual({ [SkillId.parse('braid-ask')]: 'allow' })
  })

  it('updateMember replaces, rather than merges, the skillOverrides map', async () => {
    const { registry } = await makeSeededRegistry()
    await registry.addMember(rootPath, {
      userId: 'usr-1' as UserId,
      role: 'guest',
      joinedAt: TEST_TIMESTAMP,
      skillOverrides: { [SkillId.parse('braid-ask')]: 'allow', [SkillId.parse('braid-extract')]: 'deny' },
    })

    const updated = await registry.updateMember(rootPath, 'usr-1' as UserId, {
      skillOverrides: { [SkillId.parse('braid-model')]: 'allow' },
    })

    expect(updated.skillOverrides).toEqual({ [SkillId.parse('braid-model')]: 'allow' })
  })

  it('transferOwnership demotes the current owner and promotes the target atomically', async () => {
    const { registry } = await makeSeededRegistry()
    await registry.addMember(rootPath, { userId: 'usr-owner' as UserId, role: 'owner', joinedAt: TEST_TIMESTAMP })
    await registry.addMember(rootPath, { userId: 'usr-next' as UserId, role: 'maintainer', joinedAt: TEST_TIMESTAMP })

    await registry.transferOwnership(rootPath, 'usr-next' as UserId)
    const members = await registry.listMembers(rootPath)

    expect(members.find(m => m.userId === 'usr-owner')?.role).toBe('maintainer')
    expect(members.find(m => m.userId === 'usr-next')?.role).toBe('owner')
    expect(members.filter(m => m.role === 'owner')).toHaveLength(1)
  })

  it('transferOwnership rejects targets who are not members', async () => {
    const { registry } = await makeSeededRegistry()
    await registry.addMember(rootPath, { userId: 'usr-owner' as UserId, role: 'owner', joinedAt: TEST_TIMESTAMP })

    await expect(registry.transferOwnership(rootPath, 'usr-stranger' as UserId)).rejects.toThrow()
  })
})
