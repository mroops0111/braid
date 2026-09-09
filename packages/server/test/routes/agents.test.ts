import type { AgentPlugin } from '@braidhq/core'
import type { AgentKind } from '@braidhq/schema'
import { PluginRegistry } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { createAgentsRouter } from '../../src/routes/agents.js'

function agentPlugin(kind: string, credentialCommand?: string): AgentPlugin {
  return {
    id: `agent.${kind}`,
    type: 'agent',
    kind: kind as AgentKind,
    configSchema: undefined,
    ...(credentialCommand ? { credentialCommand } : {}),
    createBinding: () => ({}),
  } as unknown as AgentPlugin
}

function router(...plugins: AgentPlugin[]) {
  const pluginRegistry = new PluginRegistry()
  for (const plugin of plugins)
    pluginRegistry.register(plugin)
  return createAgentsRouter({ pluginRegistry })
}

describe('GET /agents', () => {
  // Studio reads this instead of naming an agent it does not depend on.
  it('names the command that produces a credential', async () => {
    const response = await router(agentPlugin('claude-code', 'claude setup-token')).request('/')
    expect(await response.json()).toEqual({
      agents: [{ kind: 'claude-code', credentialCommand: 'claude setup-token' }],
    })
  })

  // A deployment may register a second agent,
  // and a skill may name it, so both owe the reader a credential field.
  it('lists every registered agent, not only the configured default', async () => {
    const response = await router(
      agentPlugin('claude-code', 'claude setup-token'),
      agentPlugin('codex'),
    ).request('/')
    const body = await response.json() as { agents: { kind: string }[] }
    expect(body.agents.map(agent => agent.kind)).toEqual(['claude-code', 'codex'])
  })

  // The field is optional, so a page that reads it must cope with absence
  // rather than printing an instruction the agent never gave.
  it('omits the command for an agent that declares none', async () => {
    const response = await router(agentPlugin('codex')).request('/')
    expect(await response.json()).toEqual({ agents: [{ kind: 'codex' }] })
  })

  it('answers an empty list where no agent is registered', async () => {
    const response = await router().request('/')
    expect(await response.json()).toEqual({ agents: [] })
  })
})
