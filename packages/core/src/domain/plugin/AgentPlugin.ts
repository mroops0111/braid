import type { AgentBindingDescriptor, AgentKind } from '@telos/schema'
import type { AgentBinding } from '../agent/AgentBinding.js'
import type { Plugin } from './Plugin.js'

export interface AgentPlugin extends Plugin {
  readonly type: 'agent'
  readonly kind: AgentKind
  createBinding: (descriptor: AgentBindingDescriptor) => AgentBinding
}
