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

/**
 * Public projection of a source-loader plugin returned by `GET /source-loaders`.
 * Carries only what Studio needs to render the dropdown; the per-kind config
 * schema is not included because per-kind UI forms stay client-side.
 */
export const SourceLoaderEntry = z.object({
  kind: LoaderKind,
  pluginId: PluginId,
})
export type SourceLoaderEntry = z.infer<typeof SourceLoaderEntry>

export const ListSourceLoadersResponse = z.object({
  loaders: z.array(SourceLoaderEntry),
})
export type ListSourceLoadersResponse = z.infer<typeof ListSourceLoadersResponse>
