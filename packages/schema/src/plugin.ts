import { z } from 'zod'
import { PluginId } from './common.js'
import { LoaderKind } from './source.js'

export const PluginType = z.enum([
  'agent',
  'ontology',
  'source-loader',
  'storage',
  'view-generator',
])
export type PluginType = z.infer<typeof PluginType>

// Projection for the source-loaders endpoint, minus the client-side config schema.
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
