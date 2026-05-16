import type {
  AbsolutePath,
  McpServerConfig,
  McpServerId,
  SourceDescriptor,
  SourceId,
  StorageDescriptor,
  StorageKind,
} from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { NotFoundError, type Workspace } from '../../../src/index.js'
import { makeWorkspace } from '../../helpers/fakes.js'

const MCP_SOURCES: readonly SourceDescriptor[] = [
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
]

const MCP_SERVERS: readonly McpServerConfig[] = [
  {
    id: 'redmine' as McpServerId,
    transport: 'streamable-http',
    url: 'https://redmine.example.com/mcp',
  },
]

const NEO4J_STORAGE: StorageDescriptor = {
  kind: 'neo4j' as StorageKind,
  config: { uri: 'bolt://localhost:7687', user: 'neo4j' },
}

function buildWorkspace(overrides: { mcpServers?: readonly McpServerConfig[] } = {}): Workspace {
  return makeWorkspace({
    sources: MCP_SOURCES,
    mcpServers: overrides.mcpServers ?? MCP_SERVERS,
    storage: NEO4J_STORAGE,
  })
}

describe('Workspace.resolveAgentForTask', () => {
  it('returns the task-specific binding when one is configured', () => {
    const workspace = makeWorkspace({
      agents: { default: 'claude-default' as never, tasks: { ask: 'claude-fast' as never } },
    })
    expect(workspace.resolveAgentForTask('ask')).toBe('claude-fast')
  })

  it('falls back to the default binding when a task is not mapped', () => {
    const workspace = buildWorkspace()
    expect(workspace.resolveAgentForTask('unmapped')).toBe('claude-default')
  })
})

describe('Workspace source partitions', () => {
  it('splits sources by role into codeSources / intentSources', () => {
    const workspace = buildWorkspace()
    expect(workspace.codeSources()).toHaveLength(1)
    expect(workspace.intentSources()).toHaveLength(2)
  })

  it('splits sources by kind into filesystemSources / mcpSources', () => {
    const workspace = buildWorkspace()
    expect(workspace.filesystemSources()).toHaveLength(2)
    expect(workspace.mcpSources()).toHaveLength(1)
  })

  it('lists only filesystem source paths in resolveAddDirs', () => {
    const workspace = buildWorkspace()
    expect(workspace.resolveAddDirs()).toEqual(['/abs/code/a', '/abs/intent'])
  })

  it('looks up sources by name (findSource / requireSource)', () => {
    const workspace = buildWorkspace()
    expect(workspace.findSource('api')?.kind).toBe('filesystem')
    expect(workspace.findSource('missing')).toBeUndefined()
    expect(() => workspace.requireSource('missing')).toThrow(NotFoundError)
  })
})

describe('Workspace MCP servers', () => {
  it('looks up MCP server configs by id', () => {
    const workspace = buildWorkspace()
    expect(workspace.findMcpServer('redmine' as McpServerId)?.transport).toBe('streamable-http')
    expect(workspace.findMcpServer('xwiki' as McpServerId)).toBeUndefined()
  })

  it('throws NotFoundError when a source references an undeclared MCP server', () => {
    const workspace = buildWorkspace({ mcpServers: [] })
    const mcpSource = workspace.mcpSources()[0]!
    expect(() => workspace.resolveMcpServerForSource(mcpSource)).toThrow(NotFoundError)
  })

  it('resolves the matching MCP server config for a source', () => {
    const workspace = buildWorkspace()
    const mcpSource = workspace.mcpSources()[0]!
    expect(workspace.resolveMcpServerForSource(mcpSource).id).toBe('redmine')
  })
})
