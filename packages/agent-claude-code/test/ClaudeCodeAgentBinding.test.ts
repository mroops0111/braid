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
} from '@braidhq/schema'
import { SkillManifest, Workspace } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeAgentBinding } from '../src/ClaudeCodeAgentBinding.js'

const descriptor: AgentBindingDescriptor = {
  id: 'claude-opus' as AgentId,
  kind: 'claude-code' as never,
  model: 'opus',
  effort: 'high',
  extraArgs: ['--verbose-stream'],
  env: { FOO: 'bar' },
}

function buildWorkspace(): Workspace {
  const manifest: ProductManifest = {
    name: 'ws-1',
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: { default: 'claude-opus' as AgentId, tasks: {} },
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
  }
  return new Workspace({
    id: 'ws-1' as WorkspaceId,
    rootPath: '/abs/ws' as AbsolutePath,
    productManifest: manifest,
  })
}

function buildSkillManifest(): SkillManifest {
  const data: SkillManifestData = {
    id: 'ask' as SkillId,
    origin: 'builtin',
    path: '/abs/skills/ask/SKILL.md' as AbsolutePath,
    frontmatter: {
      name: 'ask',
      description: 'test skill',
      disableModelInvocation: false,
      braid: { requiredEnv: [], requiredPaths: [], requiredMcpServers: [] },
    },
  }
  return new SkillManifest(data)
}

describe('ClaudeCodeAgentBinding', () => {
  it('assembles claude CLI args with model, effort, mcp config, extra args, and code source --add-dir', () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)

    const result = binding.resolveSpawn({
      skillId: 'ask' as SkillId,
      args: 'what is voidTask',
      workspace: buildWorkspace(),
      manifest: buildSkillManifest(),
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

  it('forwards workspace path, workspace id, api url, and descriptor env into the child env', () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)

    const result = binding.resolveSpawn({
      skillId: 'ask' as SkillId,
      args: '',
      workspace: buildWorkspace(),
      manifest: buildSkillManifest(),
      apiUrl: 'http://localhost:4321',
    })

    expect(result.env.BRAID_WORKSPACE).toBe('/abs/ws')
    expect(result.env.BRAID_WORKSPACE_ID).toBe('ws-1')
    expect(result.env.BRAID_API_URL).toBe('http://localhost:4321')
    expect(result.env.FOO).toBe('bar')
  })

  it('throws when the binding descriptor is not claude-code', () => {
    expect(() => new ClaudeCodeAgentBinding({
      ...descriptor,
      kind: 'anthropic-api' as never,
    })).toThrow(/claude-code/)
  })
})
