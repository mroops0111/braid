import type {
  AbsolutePath,
  AgentId,
  McpServerId,
  ProductManifest,
  SourceId,
  StorageKind,
  Workspace as WorkspaceData,
  WorkspaceId,
} from '@telos/schema'
import { describe, expect, it } from 'vitest'
import { NotFoundError, Workspace } from '../../../src/index.js'

function manifest(overrides: Partial<ProductManifest> = {}): ProductManifest {
  return {
    name: 'demo',
    version: '0.0.0',
    ontologyId: 'ddd' as never,
    agents: {
      default: 'claude-default',
      tasks: { extract: 'claude-default', ask: 'claude-default' },
    },
    agentBindings: [
      {
        id: 'claude-default' as AgentId,
        kind: 'claude-code' as never,
        model: 'opus',
        effort: 'high',
        extraArgs: [],
        env: {},
      },
    ],
    sources: [
      {
        kind: 'filesystem',
        id: 'src-api' as SourceId,
        role: 'code',
        name: 'api',
        path: '/abs/code/a' as AbsolutePath,
        language: 'typescript',
      },
      {
        kind: 'filesystem',
        id: 'src-prd' as SourceId,
        role: 'intent',
        name: 'prd',
        path: '/abs/intent' as AbsolutePath,
      },
      {
        kind: 'mcp',
        id: 'src-redmine' as SourceId,
        role: 'intent',
        name: 'redmine',
        mcpServerId: 'redmine' as McpServerId,
      },
    ],
    mcpServers: [
      {
        id: 'redmine' as McpServerId,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@telos/mcp-redmine'],
        env: {},
      },
    ],
    storage: {
      kind: 'neo4j' as StorageKind,
      config: { uri: 'bolt://localhost:7687', user: 'neo4j' },
    },
    channels: [],
    ...overrides,
  }
}

function data(overrides: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    id: 'w-1' as WorkspaceId,
    rootPath: '/abs/path' as AbsolutePath,
    productManifest: manifest(),
    pluginConfig: { plugins: [] },
    ...overrides,
  }
}

describe('Workspace', () => {
  it('exposes the underlying data', () => {
    const workspace = new Workspace(data())
    expect(workspace.id).toBe('w-1')
    expect(workspace.rootPath).toBe('/abs/path')
    expect(workspace.productManifest.name).toBe('demo')
  })

  describe('resolveAgentForTask', () => {
    it('returns task-specific agent when configured', () => {
      const m = manifest({
        agents: { default: 'claude-default', tasks: { ask: 'claude-fast' } },
      })
      const workspace = new Workspace(data({ productManifest: m }))
      expect(workspace.resolveAgentForTask('ask')).toBe('claude-fast')
    })

    it('falls back to default agent when task not mapped', () => {
      const workspace = new Workspace(data())
      expect(workspace.resolveAgentForTask('unmapped')).toBe('claude-default')
    })
  })

  describe('source filtering', () => {
    it('codeSources / intentSources split by role', () => {
      const workspace = new Workspace(data())
      expect(workspace.codeSources()).toHaveLength(1)
      expect(workspace.intentSources()).toHaveLength(2)
    })

    it('filesystemSources / mcpSources split by kind', () => {
      const workspace = new Workspace(data())
      expect(workspace.filesystemSources()).toHaveLength(2)
      expect(workspace.mcpSources()).toHaveLength(1)
    })

    it('resolveAddDirs returns paths of filesystem sources', () => {
      const workspace = new Workspace(data())
      expect(workspace.resolveAddDirs()).toEqual(['/abs/code/a', '/abs/intent'])
    })

    it('findSource / requireSource lookup by name', () => {
      const workspace = new Workspace(data())
      expect(workspace.findSource('api')?.kind).toBe('filesystem')
      expect(workspace.findSource('missing')).toBeUndefined()
      expect(() => workspace.requireSource('missing')).toThrow(NotFoundError)
    })
  })

  describe('mcp servers', () => {
    it('findMcpServer looks up by id', () => {
      const workspace = new Workspace(data())
      expect(workspace.findMcpServer('redmine' as McpServerId)?.transport).toBe('stdio')
      expect(workspace.findMcpServer('xwiki' as McpServerId)).toBeUndefined()
    })

    it('resolveMcpServerForSource throws when server not declared', () => {
      const m = manifest({ mcpServers: [] })
      const workspace = new Workspace(data({ productManifest: m }))
      const mcpSource = workspace.mcpSources()[0]!
      expect(() => workspace.resolveMcpServerForSource(mcpSource)).toThrow(NotFoundError)
    })

    it('resolveMcpServerForSource returns matching config', () => {
      const workspace = new Workspace(data())
      const mcpSource = workspace.mcpSources()[0]!
      expect(workspace.resolveMcpServerForSource(mcpSource).id).toBe('redmine')
    })
  })

  it('toData returns the wrapped data unchanged', () => {
    const original = data()
    const workspace = new Workspace(original)
    expect(workspace.toData()).toBe(original)
  })
})
