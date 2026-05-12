import type { AbsolutePath, AgentId, ProductManifest, SourceId, StorageKind, WorkspaceId } from '@telos/schema'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError, Workspace } from '@telos/core'
import { describe, expect, it } from 'vitest'
import { FsSkillRegistry } from '../../../src/infrastructure/fs/FsSkillRegistry.js'

async function makeWorkspace(): Promise<{ workspace: Workspace, root: AbsolutePath }> {
  const rootPath = (await mkdtemp(join(tmpdir(), 'telos-skill-ws-'))) as AbsolutePath
  const manifest: ProductManifest = {
    name: 'demo',
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: { default: 'claude-default', tasks: {} },
    agentBindings: [{
      id: 'claude-default' as AgentId,
      kind: 'claude-code' as never,
      model: 'opus',
      extraArgs: [],
      env: {},
    }],
    sources: [{
      kind: 'filesystem',
      id: 'src-a' as SourceId,
      role: 'code',
      name: 'a',
      path: '/abs/code' as AbsolutePath,
    }],
    mcpServers: [],
    storage: { kind: 'in-memory' as StorageKind, config: {} },
    channels: [],
  }
  return {
    root: rootPath,
    workspace: new Workspace({
      id: 'ws-1' as WorkspaceId,
      rootPath,
      productManifest: manifest,
      pluginConfig: { plugins: [] },
    }),
  }
}

async function writeSkillFile(dir: string, skillId: string, name: string): Promise<void> {
  const skillDir = join(dir, skillId)
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: a test skill\n---\nbody`,
    'utf-8',
  )
}

describe('FsSkillRegistry', () => {
  it('lists builtin skills', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'telos-builtin-'))) as AbsolutePath
    await writeSkillFile(builtinRoot, 'ask', 'telos-ask')
    await writeSkillFile(builtinRoot, 'extract', 'telos-extract')

    const { workspace } = await makeWorkspace()
    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    const manifests = await registry.list(workspace)
    const ids = manifests.map(m => m.id).sort()
    expect(ids).toEqual(['ask', 'extract'])
    expect(manifests.every(m => m.origin === 'builtin')).toBe(true)
  })

  it('workspace skills override builtins', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'telos-builtin-'))) as AbsolutePath
    await writeSkillFile(builtinRoot, 'ask', 'telos-ask')

    const { workspace, root } = await makeWorkspace()
    await writeSkillFile(join(root, 'skills'), 'ask', 'telos-ask-custom')

    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    const manifest = await registry.get(workspace, 'ask' as never)
    expect(manifest.origin).toBe('workspace')
    expect(manifest.frontmatter.name).toBe('telos-ask-custom')
  })

  it('extension annotates builtin skill with extensionPath', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'telos-builtin-'))) as AbsolutePath
    await writeSkillFile(builtinRoot, 'extract', 'telos-extract')

    const { workspace, root } = await makeWorkspace()
    const extensionDir = join(root, 'skill-extensions', 'telos-extract')
    await mkdir(extensionDir, { recursive: true })
    await writeFile(join(extensionDir, 'EXTEND.md'), '# extra context', 'utf-8')

    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    const manifest = await registry.get(workspace, 'extract' as never)
    expect(manifest.origin).toBe('builtin')
    expect(manifest.isExtended()).toBe(true)
    expect(manifest.extensionPath).toBeTruthy()
  })

  it('get throws NotFoundError when skill missing', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'telos-builtin-'))) as AbsolutePath
    const { workspace } = await makeWorkspace()
    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    await expect(registry.get(workspace, 'missing' as never)).rejects.toThrow(NotFoundError)
  })
})
