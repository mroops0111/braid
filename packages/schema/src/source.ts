import { z } from 'zod'
import { AbsolutePath, PluginId, SourceId } from './common.js'
import { McpServerId } from './mcp.js'
import { SourceSyncPolicy } from './source-sync.js'

/** Open set. The active ontology declares its own roles, core stays agnostic. */
export const SourceRole = z.string().min(1).brand<'SourceRole'>()
export type SourceRole = z.infer<typeof SourceRole>

export const SourceKind = z.enum(['filesystem', 'mcp'])
export type SourceKind = z.infer<typeof SourceKind>

/** Picks the SourceLoader plugin. Branded so new loaders need no edit here. */
export const LoaderKind = z.string().min(1).brand<'LoaderKind'>()
export type LoaderKind = z.infer<typeof LoaderKind>

/** kind picks the loader. config is opaque, validated by the loader at runtime. */
export const SourceLoaderDescriptor = z.object({
  kind: LoaderKind,
  config: z.unknown(),
})
export type SourceLoaderDescriptor = z.infer<typeof SourceLoaderDescriptor>

export const FilesystemSourceDescriptor = z.object({
  kind: z.literal('filesystem'),
  id: SourceId,
  role: SourceRole,
  name: z.string().min(1),
  path: AbsolutePath,
  language: z.string().optional(),
  // Omitted means manual. The user manages the directory, Braid does no provisioning.
  loader: SourceLoaderDescriptor.optional(),
  // Omitted means this source only refreshes when someone asks for it.
  // Meaningful only alongside a loader, a manual directory has nothing to pull.
  sync: SourceSyncPolicy.optional(),
  // Read verbatim by skills so the agent can prioritise and cite this source.
  description: z.string().optional(),
})
export type FilesystemSourceDescriptor = z.infer<typeof FilesystemSourceDescriptor>

export const McpSourceScope = z.object({
  tags: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
})
export type McpSourceScope = z.infer<typeof McpSourceScope>

export const McpSourceDescriptor = z.object({
  kind: z.literal('mcp'),
  id: SourceId,
  role: SourceRole,
  name: z.string().min(1),
  mcpServerId: McpServerId,
  scope: McpSourceScope.optional(),
  description: z.string().optional(),
})
export type McpSourceDescriptor = z.infer<typeof McpSourceDescriptor>

export const SourceDescriptor = z.discriminatedUnion('kind', [
  FilesystemSourceDescriptor,
  McpSourceDescriptor,
])
export type SourceDescriptor = z.infer<typeof SourceDescriptor>

/** Projection for the source-loaders endpoint, minus the client-side config schema. */
export const SourceLoaderEntry = z.object({
  kind: LoaderKind,
  pluginId: PluginId,
  // Studio gates the webhook panel on this flag, not kind, so new loaders need no UI change.
  webhook: z.boolean().default(false),
})
export type SourceLoaderEntry = z.infer<typeof SourceLoaderEntry>

export const ListSourceLoadersResponse = z.object({
  loaders: z.array(SourceLoaderEntry),
})
export type ListSourceLoadersResponse = z.infer<typeof ListSourceLoadersResponse>
