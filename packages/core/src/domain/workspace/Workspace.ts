import type {
  AbsolutePath,
  AgentBindingDescriptor,
  AgentRoutingConfig,
  ChannelDescriptor,
  FilesystemSourceDescriptor,
  McpServerConfig,
  McpServerId,
  McpSourceDescriptor,
  PluginConfig,
  PluginDescriptor,
  ProductManifest,
  SourceDescriptor,
  StorageDescriptor,
  Workspace as WorkspaceData,
  WorkspaceId,
} from '@braidhq/schema'
import { NotFoundError } from '../errors.js'

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

  get pluginConfig(): PluginConfig {
    return this.data.pluginConfig
  }

  get sources(): readonly SourceDescriptor[] {
    return this.data.productManifest.sources
  }

  get mcpServers(): readonly McpServerConfig[] {
    return this.data.productManifest.mcpServers
  }

  get agentBindings(): readonly AgentBindingDescriptor[] {
    return this.data.productManifest.agentBindings
  }

  get agentRouting(): AgentRoutingConfig {
    return this.data.productManifest.agents
  }

  get storage(): StorageDescriptor {
    return this.data.productManifest.storage
  }

  get channels(): readonly ChannelDescriptor[] {
    return this.data.productManifest.channels
  }

  get plugins(): readonly PluginDescriptor[] {
    return this.data.pluginConfig.plugins
  }

  codeSources(): readonly SourceDescriptor[] {
    return this.sources.filter(source => source.role === 'code')
  }

  intentSources(): readonly SourceDescriptor[] {
    return this.sources.filter(source => source.role === 'intent')
  }

  filesystemSources(): readonly FilesystemSourceDescriptor[] {
    return this.sources.filter((source): source is FilesystemSourceDescriptor => source.kind === 'filesystem')
  }

  mcpSources(): readonly McpSourceDescriptor[] {
    return this.sources.filter((source): source is McpSourceDescriptor => source.kind === 'mcp')
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

  resolveAgentForTask(taskName: string): string {
    const tasks = this.data.productManifest.agents.tasks
    return tasks[taskName] ?? this.data.productManifest.agents.default
  }

  toData(): WorkspaceData {
    return this.data
  }
}
