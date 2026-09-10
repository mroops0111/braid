import type { AgentBindingDescriptor, AgentKind } from '@braidhq/schema'
import type { AgentBinding } from '../agent/AgentBinding.js'
import type { Plugin } from './Plugin.js'

export interface AgentPlugin extends Plugin {
  readonly type: 'agent'
  readonly kind: AgentKind
  /**
   * The command a person runs to obtain a credential for this agent.
   *
   * Declared here because only the plugin knows it,
   * and a reader is otherwise left to guess what to paste.
   * Absent where an agent has no such command,
   * and the settings page then asks for the credential without naming one.
   */
  readonly credentialCommand?: string
  createBinding: (descriptor: AgentBindingDescriptor) => AgentBinding
}
