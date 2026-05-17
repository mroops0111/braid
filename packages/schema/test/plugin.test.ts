import { describe, expect, it } from 'vitest'
import { PluginType } from '../src/index.js'

describe('pluginType', () => {
  it('lists the registered plugin types (5 axes: agent / ontology / source-loader / storage / view-generator)', () => {
    expect(PluginType.options).toEqual([
      'agent',
      'ontology',
      'source-loader',
      'storage',
      'view-generator',
    ])
  })

  it('rejects "source" (sources are workspace descriptors, not plugins; loaders provision them)', () => {
    expect(PluginType.safeParse('source').success).toBe(false)
  })

  it('rejects "skill" (skills are markdown files, not plugins)', () => {
    expect(PluginType.safeParse('skill').success).toBe(false)
  })

  it('rejects "validator" (framework invariants live in core, ontology-coupled validators ship with ontology)', () => {
    expect(PluginType.safeParse('validator').success).toBe(false)
  })

  it('rejects "channel" (clients are independent packages, not server-internal plugins)', () => {
    expect(PluginType.safeParse('channel').success).toBe(false)
  })

  it('rejects unknown type', () => {
    expect(PluginType.safeParse('mystery').success).toBe(false)
  })
})
