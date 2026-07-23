import type { AbsolutePath, PluginId, SkillRunId, SourceId, WorkspaceId } from '@braidhq/schema'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Plugin, PluginRegistry, type SkillRunner, type Workspace } from '@braidhq/core'
import { makeWorkspace as makeBaseWorkspace } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composeApp.js'
import { FsSkillRegistry } from '../../src/infrastructure/skill/FsSkillRegistry.js'
import { readJson } from '../helpers/readJson.js'
import { makeSkillFileContents } from '../helpers/skillFixtures.js'

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

const WORKSPACE_ID = 'demo' as WorkspaceId

async function writePluginSkill(parent: string, skillName: string, displayName: string): Promise<string> {
  const dir = join(parent, skillName)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    makeSkillFileContents({
      name: displayName,
      description: 'a plugin-shipped skill for integration testing',
    }),
    'utf-8',
  )
  return dir
}

function makeWorkspace(rootPath: AbsolutePath): Workspace {
  // Production derives WorkspaceId from manifest.name, so keep them aligned.
  return makeBaseWorkspace({
    id: WORKSPACE_ID,
    ontologyId: 'tiny',
    rootPath,
    sources: [{
      kind: 'filesystem',
      id: 'src-a' as SourceId,
      role: 'code',
      name: 'a',
      path: '/abs/code' as AbsolutePath,
    }],
  })
}

function fakeOntologyWithSkill(pluginId: string, skillNamespace: string, directory: string): Plugin {
  return {
    id: pluginId as PluginId,
    type: 'ontology' as const,
    configSchema: z.object({}),
    skillNamespace,
    skills: [{ directory }],
  }
}

const noopSkillRunner: SkillRunner = {
  start: async () => 'fake-run-id' as SkillRunId,
  subscribe: () => ({ unsubscribe: () => {}, positionAtSubscribe: 0 }),
  isActive: () => false,
  cancel: async () => {},
  forgetSession: async () => {},
}

interface SkillsResponseBody {
  items: Array<{ id: string, origin: string, frontmatter: { name: string } }>
}

describe('plugin-shipped skills (integration)', () => {
  it('surfaces a plugin-declared SKILL.md through GET /workspaces/:ws/skills with origin=plugin', async () => {
    const pluginSkillsRoot = (await mkdtemp(join(tmpdir(), 'braid-plugin-skills-'))) as AbsolutePath
    // The plugin ships verb `design` under its own `redoc` namespace.
    const skillDir = await writePluginSkill(pluginSkillsRoot, 'design', 'design')

    const pluginRegistry = new PluginRegistry()
    pluginRegistry.register(fakeOntologyWithSkill('plugin.redoc', 'redoc', skillDir))

    const builtinSkillsRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
    const wsRoot = (await mkdtemp(join(tmpdir(), 'braid-ws-'))) as AbsolutePath

    const skillRegistry = new FsSkillRegistry({ builtinSkillsRoot, pluginRegistry })

    const deps = composeApp({
      pluginRegistry,
      skillRegistry,
      skillRunner: noopSkillRunner,
    })
    await deps.workspaceRepository.save(makeWorkspace(wsRoot))
    const app = createApp(deps)

    const response = await app.request(`/workspaces/${WORKSPACE_ID}/skills`)
    expect(response.status).toBe(200)
    const body = await readJson<SkillsResponseBody>(response)
    const plugin = body.items.find(item => item.id === 'redoc:design')
    expect(plugin?.origin).toBe('plugin')
  })

  it('surfaces a workspace skill separately from a same-verb plugin skill', async () => {
    const pluginSkillsRoot = (await mkdtemp(join(tmpdir(), 'braid-plugin-skills-'))) as AbsolutePath
    const skillDir = await writePluginSkill(pluginSkillsRoot, 'design', 'design-plugin')

    const pluginRegistry = new PluginRegistry()
    pluginRegistry.register(fakeOntologyWithSkill('plugin.redoc', 'redoc', skillDir))

    const builtinSkillsRoot = (await mkdtemp(join(tmpdir(), 'braid-builtin-'))) as AbsolutePath
    const wsRoot = (await mkdtemp(join(tmpdir(), 'braid-ws-'))) as AbsolutePath
    // The workspace skill in dir `design` composes to `workspace:design`,
    // distinct from the plugin's `redoc:design`, so both appear.
    await writePluginSkill(join(wsRoot, 'skills'), 'design', 'design-local')

    const skillRegistry = new FsSkillRegistry({ builtinSkillsRoot, pluginRegistry })
    const deps = composeApp({ pluginRegistry, skillRegistry, skillRunner: noopSkillRunner })
    await deps.workspaceRepository.save(makeWorkspace(wsRoot))
    const app = createApp(deps)

    const response = await app.request(`/workspaces/${WORKSPACE_ID}/skills`)
    const body = await readJson<SkillsResponseBody>(response)

    const workspaceSkill = body.items.find(item => item.id === 'workspace:design')
    expect(workspaceSkill?.origin).toBe('workspace')
    expect(workspaceSkill?.frontmatter.name).toBe('design-local')

    const pluginSkill = body.items.find(item => item.id === 'redoc:design')
    expect(pluginSkill?.origin).toBe('plugin')
    expect(pluginSkill?.frontmatter.name).toBe('design-plugin')
  })
})
