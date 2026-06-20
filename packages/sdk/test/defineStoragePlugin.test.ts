import type { ModelRepository, StoragePluginContext } from '@braidhq/core'
import type { StorageDescriptor, StorageKind, WorkspaceId } from '@braidhq/schema'
import { ValidationError } from '@braidhq/core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineStoragePlugin } from '../src/defineStoragePlugin.js'

const stubRepo: ModelRepository = {
  load: vi.fn(),
  save: vi.fn(),
  applyOperations: vi.fn(),
} as unknown as ModelRepository

const stubContext: StoragePluginContext = {
  workspaceRootPath: '/tmp/ws',
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  resolveWorkspaceRoot: async (_id: WorkspaceId) => '/tmp/ws',
}

describe('defineStoragePlugin', () => {
  it('builds a frozen plugin with storage.<kind> as the default id', () => {
    const plugin = defineStoragePlugin({
      kind: 'memory',
      configSchema: z.object({}),
      createModelRepository: async () => stubRepo,
    })
    expect(plugin.id).toBe('storage.memory')
    expect(plugin.type).toBe('storage')
    expect(plugin.kind).toBe('memory' as StorageKind)
    expect(Object.isFrozen(plugin)).toBe(true)
  })

  it('parses descriptor.config through the schema before calling createModelRepository', async () => {
    const createSpy = vi.fn(async () => stubRepo)
    const plugin = defineStoragePlugin({
      kind: 'memory',
      configSchema: z.object({ retainDays: z.number().int().positive() }),
      createModelRepository: createSpy,
    })

    const descriptor = {
      kind: 'memory' as StorageKind,
      config: { retainDays: 7 },
    } as StorageDescriptor

    await plugin.createModelRepository(descriptor, stubContext)

    expect(createSpy).toHaveBeenCalledOnce()
    expect(createSpy).toHaveBeenCalledWith({ retainDays: 7 }, descriptor, stubContext)
  })

  it('rejects descriptors whose config fails the schema', async () => {
    const plugin = defineStoragePlugin({
      kind: 'memory',
      configSchema: z.object({ retainDays: z.number().int().positive() }),
      createModelRepository: async () => stubRepo,
    })

    const descriptor = {
      kind: 'memory' as StorageKind,
      config: { retainDays: -1 },
    } as StorageDescriptor

    await expect(plugin.createModelRepository(descriptor, stubContext)).rejects.toThrow()
  })

  it('throws ValidationError on empty kind at build time', () => {
    expect(() => defineStoragePlugin({
      kind: '',
      configSchema: z.object({}),
      createModelRepository: async () => stubRepo,
    })).toThrow(ValidationError)
  })

  it('honours an explicit pluginId override', () => {
    const plugin = defineStoragePlugin({
      kind: 'memory',
      pluginId: 'storage.acme-memory',
      configSchema: z.object({}),
      createModelRepository: async () => stubRepo,
    })
    expect(plugin.id).toBe('storage.acme-memory')
  })
})
