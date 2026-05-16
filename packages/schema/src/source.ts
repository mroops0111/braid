import { z } from 'zod'
import { AbsolutePath, SourceId } from './common.js'
import { McpServerId } from './mcp.js'

export const SourceRole = z.enum(['code', 'intent'])
export type SourceRole = z.infer<typeof SourceRole>

export const SourceKind = z.enum(['filesystem', 'mcp'])
export type SourceKind = z.infer<typeof SourceKind>

/**
 * Provisioning kind for a filesystem source. Identifies which `SourceLoader`
 * plugin populates the local path before claude reads it. Branded so users
 * can register custom loaders without editing this file.
 */
export const LoaderKind = z.string().min(1).brand<'LoaderKind'>()
export type LoaderKind = z.infer<typeof LoaderKind>

/**
 * Per-source loader config. `kind` selects the loader plugin; `config` is
 * opaque here and validated by the loader's own `configSchema` at runtime.
 *
 * Omitting `loader` on a `FilesystemSourceDescriptor` means "manual": the
 * user manages the directory themselves; Braid performs no ingestion or
 * sync. That's the default and preserves backwards compatibility with
 * existing workspaces.
 */
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
  loader: SourceLoaderDescriptor.optional(),
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
})
export type McpSourceDescriptor = z.infer<typeof McpSourceDescriptor>

export const SourceDescriptor = z.discriminatedUnion('kind', [
  FilesystemSourceDescriptor,
  McpSourceDescriptor,
])
export type SourceDescriptor = z.infer<typeof SourceDescriptor>
