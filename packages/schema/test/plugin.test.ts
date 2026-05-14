import { describe, expect, it } from 'vitest'
import { PluginDescriptor, PluginType } from '../src/index.js'

describe('pluginType', () => {
  it('lists the registered plugin types', () => {
    expect(PluginType.options).toEqual([
      'agent',
      'channel',
      'generator',
      'ontology',
      'source-loader',
      'storage',
      'validator',
    ])
  })

  it('rejects "source" (sources are workspace descriptors, not plugins; loaders provision them)', () => {
    expect(PluginType.safeParse('source').success).toBe(false)
  })

  it('rejects "skill" (skills are markdown files, not plugins)', () => {
    expect(PluginType.safeParse('skill').success).toBe(false)
  })

  it('rejects unknown type', () => {
    expect(PluginType.safeParse('mystery').success).toBe(false)
  })
})

describe('pluginDescriptor', () => {
  it('parses a generator descriptor', () => {
    const descriptor = PluginDescriptor.parse({
      pluginId: 'generator-mermaid',
      type: 'generator',
      config: { theme: 'dark' },
    })
    expect(descriptor.type).toBe('generator')
  })

  it('parses an agent descriptor', () => {
    const descriptor = PluginDescriptor.parse({
      pluginId: 'agent-anthropic-sdk',
      type: 'agent',
      config: {},
    })
    expect(descriptor.type).toBe('agent')
  })
})
