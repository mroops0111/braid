import type { AbsolutePath, AgentBindingDescriptor, AgentId, ProductManifest, SkillId, SkillManifest as SkillManifestData, SourceId, StorageKind, WorkspaceId } from '@telos/schema'
import { SkillManifest, Workspace } from '@telos/core'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeAgentBinding } from '../../../src/infrastructure/agent/ClaudeCodeAgentBinding.js'

const descriptor: AgentBindingDescriptor = {
  id: 'claude-opus' as AgentId,
  kind: 'claude-code' as never,
  model: 'opus',
  effort: 'high',
  extraArgs: ['--verbose-stream'],
  env: { FOO: 'bar' },
}

function makeWorkspace(): Workspace {
  const manifest: ProductManifest = {
    name: 'demo',
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: { default: 'claude-opus', tasks: {} },
    agentBindings: [descriptor],
    sources: [{
      kind: 'filesystem',
      id: 'code-api' as SourceId,
      role: 'code',
      name: 'api',
      path: '/abs/code/api' as AbsolutePath,
    }],
    mcpServers: [],
    storage: { kind: 'in-memory' as StorageKind, config: {} },
    channels: [],
  }
  return new Workspace({
    id: 'ws-1' as WorkspaceId,
    rootPath: '/abs/ws' as AbsolutePath,
    productManifest: manifest,
    pluginConfig: { plugins: [] },
  })
}

function makeManifest(): SkillManifest {
  const data: SkillManifestData = {
    id: 'ask' as SkillId,
    origin: 'builtin',
    path: '/abs/skills/ask/SKILL.md' as AbsolutePath,
    frontmatter: {
      name: 'telos-ask',
      description: 'a',
      disableModelInvocation: false,
      requiredEnv: [],
      requiredPaths: [],
      requiredMcpServers: [],
    },
  }
  return new SkillManifest(data)
}

describe('ClaudeCodeAgentBinding', () => {
  it('resolveSpawn assembles claude CLI args', () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)
    const result = binding.resolveSpawn({
      skillId: 'ask' as SkillId,
      args: 'what is voidTask',
      workspace: makeWorkspace(),
      manifest: makeManifest(),
      apiUrl: 'http://localhost:4321',
      mcpConfigFile: '/tmp/.mcp.json' as AbsolutePath,
    })

    expect(result.bin).toBe('claude')
    expect(result.args).toContain('-p')
    expect(result.args).toContain('--model')
    expect(result.args).toContain('opus')
    expect(result.args).toContain('--effort')
    expect(result.args).toContain('high')
    expect(result.args).toContain('--mcp-config')
    expect(result.args).toContain('/tmp/.mcp.json')
    expect(result.args).toContain('--add-dir')
    expect(result.args).toContain('/abs/code/api')
    expect(result.args).toContain('--verbose-stream')
  })

  it('passes workspace + api info via env', () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)
    const result = binding.resolveSpawn({
      skillId: 'ask' as SkillId,
      args: '',
      workspace: makeWorkspace(),
      manifest: makeManifest(),
      apiUrl: 'http://localhost:4321',
    })
    expect(result.env.TELOS_WORKSPACE).toBe('/abs/ws')
    expect(result.env.TELOS_WORKSPACE_ID).toBe('ws-1')
    expect(result.env.TELOS_API_URL).toBe('http://localhost:4321')
    expect(result.env.FOO).toBe('bar')
  })

  it('throws when descriptor kind is not claude-code', () => {
    expect(() => new ClaudeCodeAgentBinding({
      ...descriptor,
      kind: 'anthropic-api' as never,
    })).toThrow(/claude-code/)
  })
})
