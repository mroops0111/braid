import type { AbsolutePath, AgentBindingDescriptor, AgentId, SkillId, SourceId } from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeAgentBinding } from '../../../src/infrastructure/agent/ClaudeCodeAgentBinding.js'
import { makeSkillManifest, makeWorkspace } from '../../helpers/fakes.js'

const descriptor: AgentBindingDescriptor = {
  id: 'claude-opus' as AgentId,
  kind: 'claude-code' as never,
  model: 'opus',
  effort: 'high',
  extraArgs: ['--verbose-stream'],
  env: { FOO: 'bar' },
}

function buildWorkspace() {
  return makeWorkspace({
    rootPath: '/abs/ws' as AbsolutePath,
    agentBindings: [descriptor],
    sources: [{
      kind: 'filesystem',
      id: 'code-api' as SourceId,
      role: 'code',
      name: 'api',
      path: '/abs/code/api' as AbsolutePath,
    }],
  })
}

describe('ClaudeCodeAgentBinding', () => {
  it('assembles claude CLI args with model, effort, mcp config, extra args, and code source --add-dir', () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)

    const result = binding.resolveSpawn({
      skillId: 'ask' as SkillId,
      args: 'what is voidTask',
      workspace: buildWorkspace(),
      manifest: makeSkillManifest({ id: 'ask' }),
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
      manifest: makeSkillManifest({ id: 'ask' }),
      apiUrl: 'http://localhost:4321',
    })

    expect(result.env.TELOS_WORKSPACE).toBe('/abs/ws')
    expect(result.env.TELOS_WORKSPACE_ID).toBe('ws-1')
    expect(result.env.TELOS_API_URL).toBe('http://localhost:4321')
    expect(result.env.FOO).toBe('bar')
  })

  it('throws when the binding descriptor is not claude-code', () => {
    expect(() => new ClaudeCodeAgentBinding({
      ...descriptor,
      kind: 'anthropic-api' as never,
    })).toThrow(/claude-code/)
  })
})
