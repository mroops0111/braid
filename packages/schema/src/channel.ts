import { z } from 'zod'
import { PluginId } from './common.js'

export const ChannelKind = z.string().min(1).brand<'ChannelKind'>()
export type ChannelKind = z.infer<typeof ChannelKind>

export const ChannelDescriptor = z.object({
  kind: ChannelKind,
  pluginId: PluginId.optional(),
  config: z.unknown(),
})
export type ChannelDescriptor = z.infer<typeof ChannelDescriptor>

export const HttpChannelConfig = z.object({
  port: z.number().int().positive().default(4321),
  cors: z
    .object({
      origins: z.array(z.string()).default([]),
    })
    .optional(),
})
export type HttpChannelConfig = z.infer<typeof HttpChannelConfig>
