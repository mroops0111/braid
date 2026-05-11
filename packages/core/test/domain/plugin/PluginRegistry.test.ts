import type { Plugin, PluginId, PluginType } from '@telos/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError, PluginRegistry } from '../../../src/index.js'

function fakePlugin(id: string, type: PluginType): Plugin & { id: PluginId, type: PluginType } {
  return {
    id: id as PluginId,
    type,
    configSchema: { parse: (value: unknown) => value } as never,
  }
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry

  beforeEach(() => {
    registry = new PluginRegistry()
  })

  it('register + get round-trip', () => {
    const plugin = fakePlugin('source-github', 'source')
    registry.register(plugin)
    expect(registry.get('source-github' as PluginId)).toBe(plugin)
  })

  it('throws ConflictError when registering duplicate id', () => {
    registry.register(fakePlugin('a', 'source'))
    expect(() => registry.register(fakePlugin('a', 'source'))).toThrow(ConflictError)
  })

  it('throws NotFoundError when getting missing plugin', () => {
    expect(() => registry.get('nope' as PluginId)).toThrow(NotFoundError)
  })

  it('listByType filters by type', () => {
    registry.register(fakePlugin('a', 'source'))
    registry.register(fakePlugin('b', 'source'))
    registry.register(fakePlugin('c', 'generator'))
    expect(registry.listByType('source')).toHaveLength(2)
    expect(registry.listByType('generator')).toHaveLength(1)
    expect(registry.listByType('agent')).toHaveLength(0)
  })

  it('has reflects registration state', () => {
    expect(registry.has('a' as PluginId)).toBe(false)
    registry.register(fakePlugin('a', 'source'))
    expect(registry.has('a' as PluginId)).toBe(true)
  })

  it('list returns all registered plugins', () => {
    registry.register(fakePlugin('a', 'source'))
    registry.register(fakePlugin('b', 'generator'))
    expect(registry.list().map(plugin => plugin.id).sort()).toEqual(['a', 'b'])
  })
})
