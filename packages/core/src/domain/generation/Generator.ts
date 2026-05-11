import type { ModelSnapshot, PluginId, PluginType, ViewArtifact, ViewKind } from '@telos/schema'
import type { z } from 'zod'
import type { PluginContext } from '../plugin/Plugin.js'

export interface RenderInput {
  model: ModelSnapshot
  config: unknown
}

export interface Generator {
  id: PluginId
  type: Extract<PluginType, 'generator'>
  viewKind: ViewKind
  configSchema: z.ZodSchema
  initialize?: (context: PluginContext) => Promise<void>
  dispose?: () => Promise<void>
  render: (input: RenderInput) => Promise<ViewArtifact>
}
