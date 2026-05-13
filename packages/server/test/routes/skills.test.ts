import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentId,
  ProductManifest,
  SkillId,
  SkillManifest as SkillManifestData,
  SourceId,
  StorageKind,
  WorkspaceId,
} from '@telos/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillManifest, type SkillRegistry, Workspace } from '@telos/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composition.js'
import { ClaudeCodeAgentBinding } from '../../src/infrastructure/agent/ClaudeCodeAgentBinding.js'
import { SubprocessSkillRunner } from '../../src/infrastructure/agent/SubprocessSkillRunner.js'
import { createMockSpawn } from '../helpers/mockSpawn.js'

const descriptor: AgentBindingDescriptor = {
  id: 'claude-default' as AgentId,
  kind: 'claude-code' as never,
  model: 'opus',
  effort: 'high',
  extraArgs: [],
  env: {},
}

function makeWorkspace(rootPath: AbsolutePath): Workspace {
  const manifest: ProductManifest = {
    name: 'demo',
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: { default: 'claude-default', tasks: {} },
    agentBindings: [descriptor],
    sources: [{
      kind: 'filesystem',
      id: 'code' as SourceId,
      role: 'code',
      name: 'code',
      path: rootPath,
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

function makeSkillRegistry(): SkillRegistry {
  const data: SkillManifestData = {
    id: 'ask' as SkillId,
    origin: 'builtin',
    path: '/abs/SKILL.md' as AbsolutePath,
    frontmatter: {
      name: 'telos-ask',
      description: 'a',
      disableModelInvocation: false,
      requiredEnv: [],
      requiredPaths: [],
      requiredMcpServers: [],
    },
  }
  const manifest = new SkillManifest(data)
  return {
    list: async () => [manifest],
    find: async () => manifest,
    get: async () => manifest,
  }
}

describe('skill routes', () => {
  it('GET /workspaces/:ws/skills lists manifests', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-skill-route-'))) as AbsolutePath
    const workspace = makeWorkspace(rootPath)
    const { spawn } = createMockSpawn([])
    const skillRegistry = makeSkillRegistry()
    const skillRunner = new SubprocessSkillRunner({
      skillRegistry,
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      spawn,
    })
    const deps = composeApp({ skillRegistry, skillRunner })
    await deps.workspaceRepository.save(workspace)
    const app = createApp(deps)

    const response = await app.request(`/workspaces/${workspace.id}/skills`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('ask')
  })

  it('POST /workspaces/:ws/skills/:id/run streams SSE events', async () => {
    const rootPath = (await mkdtemp(join(tmpdir(), 'telos-skill-route-'))) as AbsolutePath
    const workspace = makeWorkspace(rootPath)
    const { spawn } = createMockSpawn([{
      stdoutLines: [
        JSON.stringify({ type: 'text', text: 'hello' }),
      ],
      exitCode: 0,
    }])
    const skillRegistry = makeSkillRegistry()
    const skillRunner = new SubprocessSkillRunner({
      skillRegistry,
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      spawn,
    })
    const deps = composeApp({ skillRegistry, skillRunner })
    await deps.workspaceRepository.save(workspace)
    const app = createApp(deps)

    const response = await app.request(`/workspaces/${workspace.id}/skills/ask/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: 'what is voidTask' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')

    const text = await response.text()
    expect(text).toContain('event: started')
    expect(text).toContain('event: message')
    expect(text).toContain('event: completed')
  })

  it('returns 404 when workspace is not registered', async () => {
    const skillRegistry = makeSkillRegistry()
    const { spawn } = createMockSpawn([])
    const skillRunner = new SubprocessSkillRunner({
      skillRegistry,
      agentBinding: new ClaudeCodeAgentBinding(descriptor),
      apiUrl: 'http://localhost:4321',
      spawn,
    })
    const deps = composeApp({ skillRegistry, skillRunner })
    const app = createApp(deps)
    const response = await app.request('/workspaces/missing-ws/skills')
    expect(response.status).toBe(404)
  })
})
