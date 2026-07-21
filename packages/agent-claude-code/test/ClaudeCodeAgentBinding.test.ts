import type { AgentSpawnInput } from '@braidhq/core'
import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentId,
  AgentKind,
  OntologyId,
  ProductManifest,
  SkillId,
  SkillManifest as SkillManifestData,
  SourceId,
  StorageKind,
  WorkspaceId,
} from '@braidhq/schema'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillManifest, Workspace } from '@braidhq/core'
import { McpServerId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { ClaudeCodeAgentBinding } from '../src/ClaudeCodeAgentBinding.js'

const descriptor: AgentBindingDescriptor = {
  id: 'claude-opus' as AgentId,
  kind: 'claude-code' as AgentKind,
  model: 'opus',
  effort: 'high',
  extraArgs: ['--verbose-stream'],
  env: { FOO: 'bar' },
}

function buildWorkspace(): Workspace {
  const manifest: ProductManifest = {
    name: 'ws-1',
    version: '0.0.0',
    ontologyId: 'ddd' as OntologyId,
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

function buildSkillManifest(extensionPath?: AbsolutePath): SkillManifest {
  const data: SkillManifestData = {
    id: 'ask' as SkillId,
    origin: 'builtin',
    path: '/abs/skills/ask/SKILL.md' as AbsolutePath,
    frontmatter: {
      name: 'ask',
      description: 'test skill',
      disableModelInvocation: false,
      braid: { requiredEnv: [], requiredMcpServers: [], allowedRoles: ['owner', 'maintainer'] },
    },
    ...(extensionPath ? { extensionPath } : {}),
  }
  return new SkillManifest(data)
}

function makeInput(overrides: Partial<AgentSpawnInput> = {}): AgentSpawnInput {
  return {
    skillId: 'ask' as SkillId,
    args: 'what is voidTask',
    workspace: buildWorkspace(),
    manifest: buildSkillManifest(),
    apiUrl: 'http://localhost:4321',
    mcpServers: [],
    sessionDir: '/tmp/sess' as AbsolutePath,
    ...overrides,
  }
}

describe('ClaudeCodeAgentBinding', () => {
  it('assembles claude CLI args with model, effort, extra args, and code source --add-dir', async () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)

    const result = await binding.resolveSpawn(makeInput())

    expect(result.bin).toBe('claude')
    expect(result.args).toContain('-p')
    expect(result.args).toContain('--model')
    expect(result.args).toContain('opus')
    expect(result.args).toContain('--effort')
    expect(result.args).toContain('high')
    expect(result.args).toContain('--add-dir')
    expect(result.args).toContain('/abs/code/api')
    expect(result.args).toContain('--verbose-stream')
  })

  it('writes an mcp config file and points claude at it when servers are provided', async () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)
    const dir = await mkdtemp(join(tmpdir(), 'braid-mcp-'))

    const result = await binding.resolveSpawn(makeInput({
      sessionDir: dir as AbsolutePath,
      mcpServers: [{ id: McpServerId.parse('braid-core'), transport: 'stdio', command: 'uvx', args: [] }],
    }))

    expect(result.args).toContain('--mcp-config')
    expect(result.args).toContain(join(dir, '.braid-mcp-ws-1.json'))
  })

  it('omits --mcp-config when no servers are provided', async () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)
    const result = await binding.resolveSpawn(makeInput())
    expect(result.args).not.toContain('--mcp-config')
  })

  it('forwards workspace path, workspace id, api url, and descriptor env into the child env', async () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)

    const result = await binding.resolveSpawn(makeInput({ args: '' }))

    expect(result.env.BRAID_WORKSPACE).toBe('/abs/ws')
    expect(result.env.BRAID_WORKSPACE_ID).toBe('ws-1')
    expect(result.env.BRAID_API_URL).toBe('http://localhost:4321')
    expect(result.env.FOO).toBe('bar')
  })

  it('invokes the plain slash command when the skill has no extension', async () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)

    const result = await binding.resolveSpawn(makeInput())

    const prompt = result.args[result.args.indexOf('-p') + 1]
    expect(prompt).toBe('/ask what is voidTask')
  })

  it('points claude at the EXTEND.md path (not inlined) when the workspace extends the skill', async () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)
    const extendPath = '/abs/ws/skill-extensions/braid-ask/EXTEND.md' as AbsolutePath

    const result = await binding.resolveSpawn(makeInput({ manifest: buildSkillManifest(extendPath) }))

    const prompt = result.args[result.args.indexOf('-p') + 1]
    expect(prompt).toContain('/ask what is voidTask')
    expect(prompt).toContain(extendPath)
  })

  it('drops the slash command and extension pointer on resume', async () => {
    const binding = new ClaudeCodeAgentBinding(descriptor)

    const result = await binding.resolveSpawn(makeInput({
      args: 'follow-up question',
      manifest: buildSkillManifest('/abs/ws/skill-extensions/braid-ask/EXTEND.md' as AbsolutePath),
      resumeSessionId: 'sess-1',
    }))

    const prompt = result.args[result.args.indexOf('-p') + 1]
    expect(prompt).toBe('follow-up question')
  })

  it('throws when the binding descriptor is not claude-code', () => {
    expect(() => new ClaudeCodeAgentBinding({
      ...descriptor,
      kind: 'anthropic-api' as AgentKind,
    })).toThrow(/claude-code/)
  })
})
