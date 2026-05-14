import { z } from 'zod'
import { AgentBindingDescriptor, AgentRoutingConfig } from './agent.js'
import { ChannelDescriptor } from './channel.js'
import { AbsolutePath, OntologyId, WorkspaceId } from './common.js'
import { McpServerConfig } from './mcp.js'
import { PluginDescriptor } from './plugin.js'
import { SourceDescriptor } from './source.js'
import { StorageDescriptor } from './storage.js'

export const PluginConfig = z.object({
  plugins: z.array(PluginDescriptor).default([]),
})
export type PluginConfig = z.infer<typeof PluginConfig>

export const ProductManifest = z.object({
  name: z.string().min(1),
  version: z.string().default('0.0.0'),
  description: z.string().optional(),
  ontologyId: OntologyId.default('ddd' as OntologyId),
  sources: z.array(SourceDescriptor).default([]),
  mcpServers: z.array(McpServerConfig).default([]),
  agents: AgentRoutingConfig,
  agentBindings: z.array(AgentBindingDescriptor).default([]),
  storage: StorageDescriptor,
  channels: z.array(ChannelDescriptor).default([]),
})
export type ProductManifest = z.infer<typeof ProductManifest>

export const ProductManifestPatch = ProductManifest.partial()
export type ProductManifestPatch = z.infer<typeof ProductManifestPatch>

/**
 * Server-fillable subset used by the scaffold endpoint. The user provides
 * only what they care about (name, sources, mcpServers); the server
 * defaults the agent + storage + channel blocks so the resulting
 * PRODUCT.md is a complete, valid `ProductManifest`.
 */
export const ProductManifestDraft = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  ontologyId: OntologyId.optional(),
  sources: z.array(SourceDescriptor).default([]),
  mcpServers: z.array(McpServerConfig).default([]),
  storage: StorageDescriptor.optional(),
  agents: AgentRoutingConfig.optional(),
  agentBindings: z.array(AgentBindingDescriptor).optional(),
  channels: z.array(ChannelDescriptor).optional(),
})
export type ProductManifestDraft = z.infer<typeof ProductManifestDraft>

export const Workspace = z.object({
  id: WorkspaceId,
  rootPath: AbsolutePath,
  productManifest: ProductManifest,
  pluginConfig: PluginConfig,
})
export type Workspace = z.infer<typeof Workspace>
