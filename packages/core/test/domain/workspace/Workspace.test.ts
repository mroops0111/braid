import type {
  AbsolutePath,
  McpServerConfig,
  McpServerId,
  SourceDescriptor,
  SourceId,
  SourceRole,
  StorageDescriptor,
  StorageKind,
} from '@braidhq/schema'
import { makeFilesystemSource, makeWorkspace } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { NotFoundError, type Workspace } from '../../../src/index.js'

const MCP_SOURCES: readonly SourceDescriptor[] = [
  {
    kind: 'filesystem',
    id: 'src-api' as SourceId,
    role: 'secondary' as SourceRole,
    name: 'api',
    path: '/abs/code/a' as AbsolutePath,
    language: 'typescript',
  },
  {
    kind: 'filesystem',
    id: 'src-prd' as SourceId,
    role: 'primary' as SourceRole,
    name: 'prd',
    path: '/abs/intent' as AbsolutePath,
  },
  {
    kind: 'mcp',
    id: 'src-redmine' as SourceId,
    role: 'primary' as SourceRole,
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

describe('Workspace source partitions', () => {
  it('splits sources by role via sourcesWithRole', () => {
    const workspace = buildWorkspace()
    expect(workspace.sourcesWithRole('secondary' as SourceRole)).toHaveLength(1)
    expect(workspace.sourcesWithRole('primary' as SourceRole)).toHaveLength(2)
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

  it('findSource returns the named source, or undefined when absent', () => {
    const workspace = buildWorkspace()
    expect(workspace.findSource('api')?.kind).toBe('filesystem')
    expect(workspace.findSource('missing')).toBeUndefined()
  })

  it('requireSource returns the named source', () => {
    expect(buildWorkspace().requireSource('api').id).toBe('src-api')
  })

  it('requireSource throws NotFoundError when the name is absent', () => {
    expect(() => buildWorkspace().requireSource('missing')).toThrow(NotFoundError)
  })
})

describe('Workspace accessors', () => {
  it('exposes storage and round-trips its underlying data', () => {
    const workspace = buildWorkspace()
    expect(workspace.storage.kind).toBe('neo4j')
    expect(workspace.toData().id).toBe(workspace.id)
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

describe('Workspace sync policy', () => {
  const MANAGED = 'src-managed' as SourceId
  const NO_BUDGET = 'src-no-budget' as SourceId
  const MANUAL = 'src-manual' as SourceId
  const BUDGET_MS = 60_000

  function build(): Workspace {
    return makeWorkspace({
      sources: [
        makeFilesystemSource({ id: MANAGED, maxStalenessMs: BUDGET_MS }),
        makeFilesystemSource({ id: NO_BUDGET }),
        makeFilesystemSource({ id: MANUAL, loaderKind: null, maxStalenessMs: BUDGET_MS }),
      ],
    })
  }

  it('counts only loader-backed sources that carry a budget as managed', () => {
    expect(build().managedSources().map(source => source.id)).toEqual([MANAGED])
  })

  it('resolves a policy for a managed source and nothing for the rest', () => {
    const workspace = build()
    expect(workspace.syncPolicyFor(MANAGED)).toEqual({ maxStalenessMs: BUDGET_MS })
    expect(workspace.syncPolicyFor(NO_BUDGET)).toBeUndefined()
    expect(workspace.syncPolicyFor('src-absent' as SourceId)).toBeUndefined()
  })

  it('treats a budget on a manual source as inert, since there is nothing to pull', () => {
    expect(build().syncPolicyFor(MANUAL)).toBeUndefined()
  })

  it('polls unless the workspace explicitly opts out', () => {
    expect(build().isPollingEnabled()).toBe(true)
  })
})
