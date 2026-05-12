import type { ChannelDescriptor, ChannelKind } from '@telos/schema'
import type { Plugin, PluginContext } from './Plugin.js'

export interface ChannelStartContext extends PluginContext {
  readonly apiUrl: string
}

export interface ChannelHandle {
  stop: () => Promise<void>
}

export interface ChannelPlugin extends Plugin {
  readonly type: 'channel'
  readonly kind: ChannelKind
  start: (descriptor: ChannelDescriptor, context: ChannelStartContext) => Promise<ChannelHandle>
}
