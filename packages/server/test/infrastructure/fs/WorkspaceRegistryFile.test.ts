import type { AbsolutePath } from '@braidhq/schema'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ValidationError } from '@braidhq/core'
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
