import type {
  AbsolutePath,
  FilesystemSourceDescriptor,
  McpServerConfig,
  McpServerId,
  McpSourceDescriptor,
  ProductManifest,
  SourceDescriptor,
  SourceId,
  SourceRole,
  SourceSyncPolicy,
  StorageDescriptor,
  Workspace as WorkspaceData,
  WorkspaceId,
} from '@braidhq/schema'
import { NotFoundError } from '../errors.js'

/** A source the framework refreshes on its own, so its budget is never absent. */
export type ManagedSource = FilesystemSourceDescriptor & { readonly sync: SourceSyncPolicy }

export class Workspace {
  constructor(private readonly data: WorkspaceData) {}

  get id(): WorkspaceId {
    return this.data.id
  }

  get rootPath(): AbsolutePath {
    return this.data.rootPath
  }

  get productManifest(): ProductManifest {
    return this.data.productManifest
  }

  get sources(): readonly SourceDescriptor[] {
    return this.data.productManifest.sources
  }

  get mcpServers(): readonly McpServerConfig[] {
    return this.data.productManifest.mcpServers
  }

  get storage(): StorageDescriptor {
    return this.data.productManifest.storage
  }

  sourcesWithRole(role: SourceRole): readonly SourceDescriptor[] {
    return this.sources.filter(source => source.role === role)
  }

  filesystemSources(): readonly FilesystemSourceDescriptor[] {
    return this.sources.filter((source): source is FilesystemSourceDescriptor => source.kind === 'filesystem')
  }

  mcpSources(): readonly McpSourceDescriptor[] {
    return this.sources.filter((source): source is McpSourceDescriptor => source.kind === 'mcp')
  }

  /**
   * Sources that refresh on their own, being loader-backed and carrying a
   * staleness budget. A manual directory has nothing to pull, and a source
   * with no budget only refreshes when someone asks for it.
   */
  managedSources(): readonly ManagedSource[] {
    return this.filesystemSources().filter((source): source is ManagedSource => !!source.loader && !!source.sync)
  }

  syncPolicyFor(sourceId: SourceId): SourceSyncPolicy | undefined {
    const source = this.filesystemSources().find(candidate => candidate.id === sourceId)
    return source?.loader ? source.sync : undefined
  }

  /** Whether background refreshes run. Opting out costs latency, never freshness. */
  isPollingEnabled(): boolean {
    return this.data.productManifest.polling?.enabled !== false
  }

  resolveAddDirs(): readonly AbsolutePath[] {
    return this.filesystemSources().map(source => source.path)
  }

  resolveMcpServerForSource(source: McpSourceDescriptor): McpServerConfig {
    const server = this.findMcpServer(source.mcpServerId)
    if (!server)
      throw new NotFoundError(`MCP server "${source.mcpServerId}" not declared in workspace`)
    return server
  }

  findMcpServer(serverId: McpServerId): McpServerConfig | undefined {
    return this.mcpServers.find(server => server.id === serverId)
  }

  findSource(name: string): SourceDescriptor | undefined {
    return this.sources.find(source => source.name === name)
  }

  requireSource(name: string): SourceDescriptor {
    const source = this.findSource(name)
    if (!source)
      throw new NotFoundError(`Source "${name}" not found in workspace`)
    return source
  }

  toData(): WorkspaceData {
    return this.data
  }
}
