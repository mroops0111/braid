import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError, ValidationError } from '@telos/core'
import { AbsolutePath } from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { FsWorkspaceRepository } from '../../../src/infrastructure/fs/FsWorkspaceRepository.js'

async function createWorkspaceDir(layout: { name?: string, withManifest?: boolean }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'telos-ws-'))
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

describe('FsWorkspaceRepository', () => {
  it('loads workspace from PRODUCT.md frontmatter', async () => {
    const rootPath = AbsolutePath.parse(await createWorkspaceDir({ name: 'voidsigner' }))
    const repository = new FsWorkspaceRepository()
    const workspace = await repository.load(rootPath)
    expect(workspace.productManifest.name).toBe('voidsigner')
    expect(workspace.storage.kind).toBe('in-memory')
  })

  it('list returns workspaces loaded so far', async () => {
    const rootPath = AbsolutePath.parse(await createWorkspaceDir({ name: 'a' }))
    const repository = new FsWorkspaceRepository()
    await repository.load(rootPath)
    const all = await repository.list()
    expect(all).toHaveLength(1)
  })

  it('throws NotFoundError when directory missing', async () => {
    const repository = new FsWorkspaceRepository()
    await expect(
      repository.load(AbsolutePath.parse('/does/not/exist')),
    ).rejects.toThrow(NotFoundError)
  })

  it('throws NotFoundError when PRODUCT.md missing', async () => {
    const rootPath = AbsolutePath.parse(await createWorkspaceDir({ withManifest: false }))
    const repository = new FsWorkspaceRepository()
    await expect(repository.load(rootPath)).rejects.toThrow(NotFoundError)
  })

  it('throws ValidationError when frontmatter invalid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telos-ws-'))
    await writeFile(join(dir, 'PRODUCT.md'), '---\nname: ""\n---\n', 'utf-8')
    const repository = new FsWorkspaceRepository()
    await expect(
      repository.load(AbsolutePath.parse(dir)),
    ).rejects.toThrow(ValidationError)
  })
})
