import { describe, expect, it } from 'vitest'
import { PluginDescriptor, PluginType } from '../src/index.js'

describe('pluginType', () => {
  it('has 6 types matching proposal §7.1', () => {
    expect(PluginType.options).toEqual([
      'source',
      'generator',
      'ontology',
      'validator',
      'agent',
      'storage',
    ])
  })

  it('rejects unknown type', () => {
    expect(PluginType.safeParse('channel').success).toBe(false)
  })
})

describe('pluginDescriptor', () => {
  it('parses minimal descriptor with config blob', () => {
    const descriptor = PluginDescriptor.parse({
      pluginId: 'source-github',
      type: 'source',
      config: { repo: 'org/repo' },
    })
    expect(descriptor.type).toBe('source')
  })
})
