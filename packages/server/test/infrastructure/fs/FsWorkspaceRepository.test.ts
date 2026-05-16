import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError, ValidationError } from '@braidhq/core'
import { AbsolutePath } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { FsWorkspaceRepository } from '../../../src/infrastructure/fs/FsWorkspaceRepository.js'
import { WorkspaceRegistryFile } from '../../../src/infrastructure/fs/WorkspaceRegistryFile.js'

async function createWorkspaceDir(layout: { name?: string, withManifest?: boolean }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'braid-ws-'))
  await mkdir(dir, { recursive: true })
  if (layout.withManifest !== false) {
    const manifest = `---
name: ${layout.name ?? 'demo'}
agents:
  default: claude-default
storage:
  kind: in-memory
  config: {}
---
# Demo product`
    await writeFile(join(dir, 'PRODUCT.md'), manifest, 'utf-8')
  }
  return dir
}

async function makeRegistry(): Promise<WorkspaceRegistryFile> {
  const dir = await mkdtemp(join(tmpdir(), 'braid-registry-'))
  return new WorkspaceRegistryFile(join(dir, 'workspaces.json'))
}

describe('FsWorkspaceRepository', () => {
  it('loads workspace from PRODUCT.md frontmatter', async () => {
    const rootPath = AbsolutePath.parse(await createWorkspaceDir({ name: 'voidsigner' }))
    const repository = new FsWorkspaceRepository({ registry: await makeRegistry() })
    const workspace = await repository.load(rootPath)
    expect(workspace.productManifest.name).toBe('voidsigner')
    expect(workspace.storage.kind).toBe('in-memory')
  })

  it('save persists rootPath to the registry; list reads it back', async () => {
    const rootPath = AbsolutePath.parse(await createWorkspaceDir({ name: 'a' }))
    const registry = await makeRegistry()
    const repository = new FsWorkspaceRepository({ registry })

    const workspace = await repository.load(rootPath)
    await repository.save(workspace)

    const all = await repository.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.productManifest.name).toBe('a')
  })

  it('list survives across repository instances (registry is persisted)', async () => {
    const rootPath = AbsolutePath.parse(await createWorkspaceDir({ name: 'persist' }))
    const registry = await makeRegistry()

    const first = new FsWorkspaceRepository({ registry })
    await first.save(await first.load(rootPath))

    const second = new FsWorkspaceRepository({ registry })
    const all = await second.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.productManifest.name).toBe('persist')
  })

  it('throws NotFoundError when directory missing', async () => {
    const repository = new FsWorkspaceRepository({ registry: await makeRegistry() })
    await expect(
      repository.load(AbsolutePath.parse('/does/not/exist')),
    ).rejects.toThrow(NotFoundError)
  })

  it('throws NotFoundError when PRODUCT.md missing', async () => {
    const rootPath = AbsolutePath.parse(await createWorkspaceDir({ withManifest: false }))
    const repository = new FsWorkspaceRepository({ registry: await makeRegistry() })
    await expect(repository.load(rootPath)).rejects.toThrow(NotFoundError)
  })

  it('throws ValidationError when frontmatter invalid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'braid-ws-'))
    await writeFile(join(dir, 'PRODUCT.md'), '---\nname: ""\n---\n', 'utf-8')
    const repository = new FsWorkspaceRepository({ registry: await makeRegistry() })
    await expect(
      repository.load(AbsolutePath.parse(dir)),
    ).rejects.toThrow(ValidationError)
  })
})
