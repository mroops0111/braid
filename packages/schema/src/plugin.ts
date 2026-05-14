import { z } from 'zod'
import { PluginId } from './common.js'

export const PluginType = z.enum([
  'agent',
  'channel',
  'generator',
  'ontology',
  'source-loader',
  'storage',
  'validator',
])
export type PluginType = z.infer<typeof PluginType>

export const PluginDescriptor = z.object({
  pluginId: PluginId,
  type: PluginType,
  config: z.unknown(),
})
export type PluginDescriptor = z.infer<typeof PluginDescriptor>
