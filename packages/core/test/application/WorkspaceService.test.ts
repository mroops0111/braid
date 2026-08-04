import type { AbsolutePath, WorkspaceId } from '@braidhq/schema'
import { makeOntology, makeWorkspace } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryWorkspaceRepository } from '../../src/in-memory.js'
import { NotFoundError, PluginRegistry, ValidationError, WorkspaceService } from '../../src/index.js'

const rootPath = '/abs/ws' as AbsolutePath

describe('WorkspaceService', () => {
  let repository: InMemoryWorkspaceRepository
  let pluginRegistry: PluginRegistry
  let service: WorkspaceService

  beforeEach(() => {
    repository = new InMemoryWorkspaceRepository()
    pluginRegistry = new PluginRegistry()
    service = new WorkspaceService({ workspaceRepository: repository, pluginRegistry })
  })

  it('saves a workspace and reloads identical data', async () => {
    await service.save(makeWorkspace({ id: 'ws-1', rootPath }))
    const loaded = await service.load(rootPath)
    expect(loaded.id).toBe('ws-1')
  })

  it('throws NotFoundError when loading an unsaved root path', async () => {
    await expect(service.load(rootPath)).rejects.toThrow(NotFoundError)
  })

  it('lists every saved workspace', async () => {
    await service.save(makeWorkspace({ id: 'ws-1', rootPath }))
    await service.save(makeWorkspace({ id: 'ws-2', rootPath: '/abs/ws2' as AbsolutePath }))
    expect(await service.list()).toHaveLength(2)
  })

  it('removes a workspace so a later load fails', async () => {
    await service.save(makeWorkspace({ id: 'ws-1', rootPath }))
    await service.remove(rootPath)
    await expect(service.load(rootPath)).rejects.toThrow(NotFoundError)
  })

  it('invalidate is a no-op when the repository has no cache', () => {
    expect(() => service.invalidate(rootPath)).not.toThrow()
  })

  describe('findById', () => {
    it('returns the workspace with the matching id', async () => {
      await service.save(makeWorkspace({ id: 'ws-1', rootPath }))
      const found = await service.findById('ws-1' as WorkspaceId)
      expect(found.id).toBe('ws-1')
    })

    it('throws NotFoundError for an unregistered id', async () => {
      await expect(service.findById('ghost' as WorkspaceId)).rejects.toThrow(NotFoundError)
    })
  })

  describe('assertRequiredSourceRoles', () => {
    it('passes when the ontology declares no required roles', () => {
      expect(() => service.assertRequiredSourceRoles(makeWorkspace())).not.toThrow()
    })

    it('passes when every required role is present', () => {
      pluginRegistry.register(makeOntology({ sourceRoles: [{ id: 'primary', required: true }] }))
      expect(() => service.assertRequiredSourceRoles(makeWorkspace())).not.toThrow()
    })

    it('throws naming the single missing role', () => {
      pluginRegistry.register(makeOntology({ sourceRoles: [{ id: 'primary', required: true }, { id: 'secondary', required: true }] }))
      const assert = () => service.assertRequiredSourceRoles(makeWorkspace())
      expect(assert).toThrow(ValidationError)
      expect(assert).toThrow(/"secondary"/)
    })

    it('lists every missing role when several are absent', () => {
      pluginRegistry.register(makeOntology({ sourceRoles: [{ id: 'primary', required: true }, { id: 'secondary', required: true }] }))
      expect(() => service.assertRequiredSourceRoles(makeWorkspace({ sources: [] }))).toThrow(/roles/)
    })
  })
})
