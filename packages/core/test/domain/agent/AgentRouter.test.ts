import type { AgentRoutingConfig, PluginId } from '@telos/schema'
import { describe, expect, it } from 'vitest'
import {
  type Agent,
  AgentRouter,
  NotFoundError,
  PluginRegistry,
} from '../../../src/index.js'

function fakeAgent(id: string): Agent {
  return {
    id: id as PluginId,
    type: 'agent',
    configSchema: { parse: (value: unknown) => value } as never,
    capabilities: { streaming: true, tools: false, longContext: true },
    async *invoke() { yield { type: 'done' } },
  }
}

describe('AgentRouter', () => {
  const registry = new PluginRegistry()
  registry.register(fakeAgent('claudeCode') as never)
  registry.register(fakeAgent('anthropicApi') as never)

  it('routes task to its mapped agent', () => {
    const config: AgentRoutingConfig = {
      default: 'claudeCode',
      tasks: { ask: 'anthropicApi' },
    }
    const router = new AgentRouter(config, registry)
    expect(router.route('ask').id).toBe('anthropicApi')
  })

  it('falls back to default agent when task unmapped', () => {
    const config: AgentRoutingConfig = {
      default: 'claudeCode',
      tasks: {},
    }
    const router = new AgentRouter(config, registry)
    expect(router.route('extract').id).toBe('claudeCode')
  })

  it('throws NotFoundError when resolved agent not registered', () => {
    const config: AgentRoutingConfig = {
      default: 'missingAgent',
      tasks: {},
    }
    const router = new AgentRouter(config, registry)
    expect(() => router.route('extract')).toThrow(NotFoundError)
  })
})
