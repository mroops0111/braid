import { z } from 'zod'
import { AbsolutePath, SourceId } from './common.js'
import { McpServerId } from './mcp.js'

export const SourceRole = z.enum(['code', 'intent'])
export type SourceRole = z.infer<typeof SourceRole>

export const SourceKind = z.enum(['filesystem', 'mcp'])
export type SourceKind = z.infer<typeof SourceKind>

// Picks the SourceLoader plugin. Branded so new loaders need no edit here.
export const LoaderKind = z.string().min(1).brand<'LoaderKind'>()
export type LoaderKind = z.infer<typeof LoaderKind>

// kind picks the loader. config is opaque, validated by the loader at runtime.
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
  // Omitted means manual. The user manages the directory, Braid does no ingestion.
  loader: SourceLoaderDescriptor.optional(),
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
