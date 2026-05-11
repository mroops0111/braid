import { z } from 'zod'
import { PluginId } from './common.js'

export const PluginType = z.enum([
  'source',
  'generator',
  'ontology',
  'validator',
  'agent',
  'storage',
])
export type PluginType = z.infer<typeof PluginType>

export const PluginDescriptor = z.object({
  pluginId: PluginId,
  type: PluginType,
  // The plugin's own configSchema validates this further.
  config: z.unknown(),
})
export type PluginDescriptor = z.infer<typeof PluginDescriptor>
