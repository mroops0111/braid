import type { AgentBinding } from '@braidhq/core'
import type { AgentBindingDescriptor, AgentKind } from '@braidhq/schema'
import { ValidationError } from '@braidhq/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineAgentPlugin } from '../src/defineAgentPlugin.js'

const stubBinding = {
  descriptor: { kind: 'noop' as AgentKind } as AgentBindingDescriptor,
  resolveSpawn: () => ({ bin: 'noop', args: [], env: {} }),
} as unknown as AgentBinding

describe('defineAgentPlugin', () => {
  it('builds a frozen plugin with agent.<kind> as the default id', () => {
    const plugin = defineAgentPlugin({
      kind: 'noop',
      createBinding: () => stubBinding,
    })
    expect(plugin.id).toBe('agent.noop')
    expect(plugin.type).toBe('agent')
    expect(plugin.kind).toBe('noop' as AgentKind)
    expect(Object.isFrozen(plugin)).toBe(true)
  })

  it('defaults to a permissive configSchema when none is provided', () => {
    const plugin = defineAgentPlugin({
      kind: 'noop',
      createBinding: () => stubBinding,
    })
    // Should accept arbitrary objects without throwing.
    expect(() => plugin.configSchema.parse({ anything: 'goes' })).not.toThrow()
  })

  it('honours an explicit configSchema', () => {
    const plugin = defineAgentPlugin({
      kind: 'noop',
      configSchema: z.object({ retries: z.number().int().nonnegative() }),
      createBinding: () => stubBinding,
    })
    expect(() => plugin.configSchema.parse({ retries: 3 })).not.toThrow()
    expect(() => plugin.configSchema.parse({ retries: -1 })).toThrow()
  })

  it('delegates createBinding to the input', () => {
    const createSpy = vi.fn(() => stubBinding)
    const plugin = defineAgentPlugin({
      kind: 'noop',
      createBinding: createSpy,
    })
    const descriptor = { id: 'a1', kind: 'noop', model: 'm' } as unknown as AgentBindingDescriptor
    plugin.createBinding(descriptor)
    expect(createSpy).toHaveBeenCalledWith(descriptor)
  })

  it('throws ValidationError on empty kind at build time', () => {
    expect(() => defineAgentPlugin({
      kind: '',
      createBinding: () => stubBinding,
    })).toThrow(ValidationError)
  })

  it('honours an explicit pluginId override', () => {
    const plugin = defineAgentPlugin({
      kind: 'noop',
      pluginId: 'agent.acme-noop',
      createBinding: () => stubBinding,
    })
    expect(plugin.id).toBe('agent.acme-noop')
  })
})
