import type { Plugin, Workspace } from '@braidhq/core'
import type { AbsolutePath, PluginId, SkillId, SourceId } from '@braidhq/schema'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotFoundError, PluginRegistry } from '@braidhq/core'
import { makeWorkspace as makeBaseWorkspace } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FsSkillRegistry } from '../../../src/infrastructure/skill/FsSkillRegistry.js'
import { makeSkillFileContents } from '../../helpers/skillFixtures.js'

async function makeWorkspace(): Promise<{ workspace: Workspace, root: AbsolutePath }> {
  const rootPath = (await mkdtemp(join(tmpdir(), 'braid-skill-ws-'))) as AbsolutePath
  const workspace = makeBaseWorkspace({
    id: 'ws-1',
    rootPath,
    sources: [{
      kind: 'filesystem',
      id: 'src-a' as SourceId,
      role: 'code',
      name: 'a',
      path: '/abs/code' as AbsolutePath,
    }],
  })
  return { workspace, root: rootPath }
}

async function writeSkillFile(dir: string, skillId: string, name: string): Promise<void> {
  const skillDir = join(dir, skillId)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), makeSkillFileContents({ name }), 'utf-8')
}

describe('FsSkillRegistry', () => {
  it('lists builtin skills', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
    await writeSkillFile(builtinRoot, 'ask', 'ask')
    await writeSkillFile(builtinRoot, 'extract', 'extract')

    const { workspace } = await makeWorkspace()
    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    const manifests = await registry.list(workspace)
    const ids = manifests.map(m => m.id).sort()
    // Builtin dirs are bare verbs, but the id namespaces them under `braid`.
    expect(ids).toEqual(['braid:ask', 'braid:extract'])
    expect(manifests.every(m => m.origin === 'builtin')).toBe(true)
  })

  it('namespaces workspace skills under `workspace`, distinct from builtins', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
    await writeSkillFile(builtinRoot, 'ask', 'ask')

    const { workspace, root } = await makeWorkspace()
    await writeSkillFile(join(root, 'skills'), 'ask', 'ask-custom')

    // A workspace skill in dir `ask` composes to `workspace:ask`, distinct
    // from the builtin `braid:ask`. Both coexist under their own namespace.
    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    const custom = await registry.get(workspace, 'workspace:ask' as SkillId)
    expect(custom.origin).toBe('workspace')
    expect(custom.frontmatter.name).toBe('ask-custom')

    const builtin = await registry.get(workspace, 'braid:ask' as SkillId)
    expect(builtin.origin).toBe('builtin')
  })

  it('extension annotates builtin skill with extensionPath', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
    await writeSkillFile(builtinRoot, 'extract', 'extract')

    const { workspace, root } = await makeWorkspace()
    // The extension dir is the filesystem-safe `<namespace>-<verb>` form,
    // whose first hyphen maps to the id's colon: `braid-extract` targets
    // `braid:extract`.
    const extensionDir = join(root, 'skill-extensions', 'braid-extract')
    await mkdir(extensionDir, { recursive: true })
    await writeFile(join(extensionDir, 'EXTEND.md'), '# extra context', 'utf-8')

    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    const manifest = await registry.get(workspace, 'braid:extract' as SkillId)
    expect(manifest.origin).toBe('builtin')
    expect(manifest.isExtended()).toBe(true)
    expect(manifest.extensionPath).toBeTruthy()
  })

  it('get throws NotFoundError when skill missing', async () => {
    const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
    const { workspace } = await makeWorkspace()
    const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
    await expect(registry.get(workspace, 'missing' as SkillId)).rejects.toThrow(NotFoundError)
  })

  describe('plugin-shipped skills', () => {
    function fakeOntologyWithSkill(pluginId: string, skillNamespace: string, directory: string): Plugin {
      return {
        id: pluginId as PluginId,
        type: 'ontology' as const,
        configSchema: z.object({}),
        skillNamespace,
        skills: [{ directory }],
      } satisfies Plugin
    }

    it('lists plugin skills under the plugin origin', async () => {
      const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
      const pluginRoot = (await mkdtemp(join(tmpdir(), 'braid-plugin-'))) as AbsolutePath
      // The plugin ships its skill under its own `redoc` namespace, verb `design`.
      await writeSkillFile(pluginRoot, 'design', 'design')

      const pluginRegistry = new PluginRegistry()
      pluginRegistry.register(fakeOntologyWithSkill(
        'plugin.redoc',
        'redoc',
        join(pluginRoot, 'design'),
      ))

      const { workspace } = await makeWorkspace()
      const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot, pluginRegistry })
      const manifest = await registry.get(workspace, 'redoc:design' as SkillId)
      expect(manifest.origin).toBe('plugin')
      expect(manifest.frontmatter.name).toBe('design')
      // pluginId travels with the manifest so Studio can label the
      // sidebar badge with the contributing plugin instead of a generic
      // "plugin" string.
      expect(manifest.toData().pluginId).toBe('plugin.redoc')
    })

    it('namespaces a workspace skill separately from a same-verb plugin skill', async () => {
      const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
      const pluginRoot = (await mkdtemp(join(tmpdir(), 'braid-plugin-'))) as AbsolutePath
      await writeSkillFile(pluginRoot, 'design', 'design-plugin')

      const pluginRegistry = new PluginRegistry()
      pluginRegistry.register(fakeOntologyWithSkill(
        'plugin.redoc',
        'redoc',
        join(pluginRoot, 'design'),
      ))

      const { workspace, root } = await makeWorkspace()
      // A workspace skill in dir `design` composes to `workspace:design`, a
      // distinct id from the plugin's `redoc:design`. Both coexist.
      await writeSkillFile(join(root, 'skills'), 'design', 'design-local')

      const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot, pluginRegistry })
      const workspaceSkill = await registry.get(workspace, 'workspace:design' as SkillId)
      expect(workspaceSkill.origin).toBe('workspace')
      expect(workspaceSkill.frontmatter.name).toBe('design-local')

      const pluginSkill = await registry.get(workspace, 'redoc:design' as SkillId)
      expect(pluginSkill.origin).toBe('plugin')
      expect(pluginSkill.frontmatter.name).toBe('design-plugin')
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

  describe('SkillStructureValidator integration', () => {
    it('rejects a SKILL.md that is missing a required H2 section', async () => {
      const builtinRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
      const skillDir = join(builtinRoot, 'malformed')
      await mkdir(skillDir, { recursive: true })
      // Has frontmatter and a Role section, but is missing Procedure (and the
      // other common required sections). The validator's hard-fail should
      // surface as a thrown error citing the offending path.
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---\nname: malformed\ndescription: missing required sections\n---\n\n## Role\n\nbody.\n`,
        'utf-8',
      )

      const { workspace } = await makeWorkspace()
      const registry = new FsSkillRegistry({ builtinSkillsRoot: builtinRoot })
      await expect(registry.list(workspace)).rejects.toThrow(/Procedure/)
    })
  })
})
