import type { PluginId, PluginType } from '@telos/schema'
import type { z } from 'zod'

export interface PluginContext {
  workspaceRootPath: string
  logger: { info: (message: string) => void, error: (message: string) => void }
}

export interface Plugin {
  id: PluginId
  type: PluginType
  configSchema: z.ZodSchema
  initialize?: (context: PluginContext) => Promise<void>
  dispose?: () => Promise<void>
}
