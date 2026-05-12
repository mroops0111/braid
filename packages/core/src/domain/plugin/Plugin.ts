import type { PluginId, PluginType } from '@telos/schema'
import type { z } from 'zod'

export interface PluginLogger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export interface PluginContext {
  workspaceRootPath: string
  logger: PluginLogger
}

export interface Plugin {
  readonly id: PluginId
  readonly type: PluginType
  readonly configSchema: z.ZodSchema
  initialize?: (context: PluginContext) => Promise<void>
  dispose?: () => Promise<void>
}
