import type { AbsolutePath, AgentId, PluginId, ProductManifest, SkillId, SkillRunId, SourceId, StorageKind, WorkspaceId } from '@telos/schema'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Plugin, PluginRegistry, type SkillRunner, Workspace } from '@telos/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composition.js'
import { FsSkillRegistry } from '../../src/infrastructure/fs/FsSkillRegistry.js'

/**
 * End-to-end check that a plugin-shipped SKILL.md surfaces through the
 * HTTP API. Composes the full server stack with a PluginRegistry that
 * contains one fake ontology contributing a skill, registers a
 * workspace, then hits `GET /workspaces/:ws/skills` to assert the
 * skill comes back with `origin: 'plugin'`.
 *
 * This exercises the integration of:
 *   - Plugin.skills declaration
 *   - PluginRegistry.pluginSkills aggregation
 *   - FsSkillRegistry scanPluginSkills (resolves directory → SKILL.md)
 *   - Hono /workspaces/:ws/skills route + SkillManifest serialization
 */

async function writePluginSkill(parent: string, skillName: string, displayName: string): Promise<string> {
  const dir = join(parent, skillName)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${displayName}\ndescription: a plugin-shipped skill for integration testing\n---\nbody`,
    'utf-8',
  )
  return dir
}

function makeWorkspace(rootPath: AbsolutePath): Workspace {
  const manifest: ProductManifest = {
    name: 'demo',
    version: '0.0.0',
    ontologyId: 'tiny' as never,
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
  return new Workspace({
    id: 'ws-1' as WorkspaceId,
    rootPath,
    productManifest: manifest,
    pluginConfig: { plugins: [] },
  })
}

function fakeOntologyWithSkill(pluginId: string, skillId: string, directory: string): Plugin {
  return {
    id: pluginId as PluginId,
    type: 'ontology' as const,
    configSchema: z.object({}),
    skills: [{ id: skillId as SkillId, directory }],
  }
}

const noopSkillRunner: SkillRunner = {
  start: async () => 'fake-run-id' as SkillRunId,
}

describe('plugin-shipped skills (integration)', () => {
  it('surfaces a plugin-declared SKILL.md through GET /workspaces/:ws/skills with origin=plugin', async () => {
    const pluginSkillsRoot = (await mkdtemp(join(tmpdir(), 'telos-plugin-skills-'))) as AbsolutePath
    const skillDir = await writePluginSkill(pluginSkillsRoot, 'redoc-design', 'redoc-design')

    const pluginRegistry = new PluginRegistry()
    pluginRegistry.register(fakeOntologyWithSkill('plugin.redoc', 'redoc-design', skillDir))

    const builtinSkillsRoot = (await mkdtemp(join(tmpdir(), 'telos-builtin-'))) as AbsolutePath
    const wsRoot = (await mkdtemp(join(tmpdir(), 'telos-ws-'))) as AbsolutePath

    const skillRegistry = new FsSkillRegistry({ builtinSkillsRoot, pluginRegistry })

    const deps = composeApp({
      pluginRegistry,
      skillRegistry,
      skillRunner: noopSkillRunner,
    })
    await deps.workspaceRepository.save(makeWorkspace(wsRoot))
    const app = createApp(deps)

    const response = await app.request('/workspaces/ws-1/skills')
    expect(response.status).toBe(200)
    const body = await response.json() as { items: Array<{ id: string, origin: string }> }
    const plugin = body.items.find(item => item.id === 'redoc-design')
    expect(plugin?.origin).toBe('plugin')
  })

  it('lets a workspace-local SKILL.md override a plugin-shipped one of the same id', async () => {
    const pluginSkillsRoot = (await mkdtemp(join(tmpdir(), 'telos-plugin-skills-'))) as AbsolutePath
    const skillDir = await writePluginSkill(pluginSkillsRoot, 'redoc-design', 'redoc-design-plugin')

    const pluginRegistry = new PluginRegistry()
    pluginRegistry.register(fakeOntologyWithSkill('plugin.redoc', 'redoc-design', skillDir))

    const builtinSkillsRoot = (await mkdtemp(join(tmpdir(), 'telos-builtin-'))) as AbsolutePath
    const wsRoot = (await mkdtemp(join(tmpdir(), 'telos-ws-'))) as AbsolutePath
    await writePluginSkill(join(wsRoot, 'skills'), 'redoc-design', 'redoc-design-local')

    const skillRegistry = new FsSkillRegistry({ builtinSkillsRoot, pluginRegistry })
    const deps = composeApp({ pluginRegistry, skillRegistry, skillRunner: noopSkillRunner })
    await deps.workspaceRepository.save(makeWorkspace(wsRoot))
    const app = createApp(deps)

    const response = await app.request('/workspaces/ws-1/skills')
    const body = await response.json() as { items: Array<{ id: string, origin: string, frontmatter: { name: string } }> }
    const skill = body.items.find(item => item.id === 'redoc-design')
    expect(skill?.origin).toBe('workspace')
    expect(skill?.frontmatter.name).toBe('redoc-design-local')
  })
})
