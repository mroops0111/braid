import type { AbsolutePath, AgentId, PluginId, ProductManifest, SkillId, SourceId, StorageKind, WorkspaceId } from '@braidhq/schema'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError, type Plugin, PluginRegistry, Workspace } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FsSkillRegistry } from '../../../src/infrastructure/fs/FsSkillRegistry.js'

async function makeWorkspace(): Promise<{ workspace: Workspace, root: AbsolutePath }> {
  const rootPath = (await mkdtemp(join(tmpdir(), 'braid-skill-ws-'))) as AbsolutePath
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
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
    await writeSkillFile(builtinRoot, 'ask', 'braid-ask')
    await writeSkillFile(builtinRoot, 'extract', 'braid-extract')

    const { workspace } = await makeWorkspace()
    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    const manifests = await registry.list(workspace)
    const ids = manifests.map(m => m.id).sort()
    expect(ids).toEqual(['ask', 'extract'])
    expect(manifests.every(m => m.origin === 'builtin')).toBe(true)
  })

  it('workspace skills override builtins', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
    await writeSkillFile(builtinRoot, 'ask', 'braid-ask')

    const { workspace, root } = await makeWorkspace()
    await writeSkillFile(join(root, 'skills'), 'ask', 'braid-ask-custom')

    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    const manifest = await registry.get(workspace, 'ask' as never)
    expect(manifest.origin).toBe('workspace')
    expect(manifest.frontmatter.name).toBe('braid-ask-custom')
  })

  it('extension annotates builtin skill with extensionPath', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
    await writeSkillFile(builtinRoot, 'extract', 'braid-extract')

    const { workspace, root } = await makeWorkspace()
    const extensionDir = join(root, 'skill-extensions', 'braid-extract')
    await mkdir(extensionDir, { recursive: true })
    await writeFile(join(extensionDir, 'EXTEND.md'), '# extra context', 'utf-8')

    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    const manifest = await registry.get(workspace, 'extract' as never)
    expect(manifest.origin).toBe('builtin')
    expect(manifest.isExtended()).toBe(true)
    expect(manifest.extensionPath).toBeTruthy()
  })

  it('get throws NotFoundError when skill missing', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
    const { workspace } = await makeWorkspace()
    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    await expect(registry.get(workspace, 'missing' as never)).rejects.toThrow(NotFoundError)
  })

  describe('plugin-shipped skills', () => {
    function fakeOntologyWithSkill(pluginId: string, skillId: string, directory: string): Plugin {
      return {
        id: pluginId as PluginId,
        type: 'ontology' as const,
        configSchema: z.object({}),
        skills: [{ id: skillId as SkillId, directory }],
      } satisfies Plugin
    }

    it('lists plugin skills under the plugin origin', async () => {
      const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
      const pluginRoot = (await mkdtemp(join(tmpdir(), 'braid-plugin-'))) as AbsolutePath
      await writeSkillFile(pluginRoot, 'redoc-design', 'redoc-design')

      const pluginRegistry = new PluginRegistry()
      pluginRegistry.register(fakeOntologyWithSkill(
        'plugin.redoc',
        'redoc-design',
        join(pluginRoot, 'redoc-design'),
      ))

      const { workspace } = await makeWorkspace()
      const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot, pluginRegistry })
      const manifest = await registry.get(workspace, 'redoc-design' as never)
      expect(manifest.origin).toBe('plugin')
      expect(manifest.frontmatter.name).toBe('redoc-design')
    })

    it('workspace skills override plugin skills with the same id', async () => {
      const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
      const pluginRoot = (await mkdtemp(join(tmpdir(), 'braid-plugin-'))) as AbsolutePath
      await writeSkillFile(pluginRoot, 'redoc-design', 'redoc-design-plugin')

      const pluginRegistry = new PluginRegistry()
      pluginRegistry.register(fakeOntologyWithSkill(
        'plugin.redoc',
        'redoc-design',
        join(pluginRoot, 'redoc-design'),
      ))

      const { workspace, root } = await makeWorkspace()
      await writeSkillFile(join(root, 'skills'), 'redoc-design', 'redoc-design-local')

      const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot, pluginRegistry })
      const manifest = await registry.get(workspace, 'redoc-design' as never)
      expect(manifest.origin).toBe('workspace')
      expect(manifest.frontmatter.name).toBe('redoc-design-local')
    })

    it('throws when plugin declares a skill but SKILL.md is missing', async () => {
      const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
      const pluginRegistry = new PluginRegistry()
      pluginRegistry.register(fakeOntologyWithSkill(
        'plugin.broken',
        'broken-skill',
        '/nonexistent/path',
      ))

      const { workspace } = await makeWorkspace()
      const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot, pluginRegistry })
      await expect(registry.list(workspace)).rejects.toThrow(/broken-skill/)
    })
  })
})
