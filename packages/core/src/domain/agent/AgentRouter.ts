import type { AgentRoutingConfig, PluginId } from '@telos/schema'
import type { PluginRegistry } from '../plugin/PluginRegistry.js'
import type { Agent } from './Agent.js'

export class AgentRouter {
  constructor(
    private readonly routingConfig: AgentRoutingConfig,
    private readonly pluginRegistry: PluginRegistry,
  ) {}

  route(taskName: string): Agent {
    const agentId = this.routingConfig.tasks[taskName] ?? this.routingConfig.default
    return this.pluginRegistry.get<Agent>(agentId as PluginId)
  }
}
