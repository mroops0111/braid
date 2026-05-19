import { z } from 'zod'

export const PluginType = z.enum([
  'agent',
  'ontology',
  'source-loader',
  'storage',
  'view-generator',
])
export type PluginType = z.infer<typeof PluginType>
