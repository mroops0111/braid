import type { AbsolutePath, AgentId, OntologyId, ProductManifest, StorageKind, Workspace as WorkspaceData, WorkspaceId } from '@braidhq/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryWorkspaceRepository, NotFoundError, Workspace, WorkspaceService } from '../../src/index.js'

const rootPath = '/abs/path' as AbsolutePath

const productManifest: ProductManifest = {
  name: 'demo',
  version: '0.0.0',
  ontologyId: 'ddd' as OntologyId,
  agents: { default: 'claudeCode' as AgentId, tasks: {} },
  agentBindings: [],
  sources: [],
  mcpServers: [],
  storage: { kind: 'in-memory' as StorageKind, config: {} },
}

const workspaceData: WorkspaceData = {
  id: 'w-1' as WorkspaceId,
  rootPath,
  productManifest,
}

describe('WorkspaceService', () => {
  let repository: InMemoryWorkspaceRepository
  let service: WorkspaceService

  beforeEach(() => {
    repository = new InMemoryWorkspaceRepository()
    service = new WorkspaceService({ workspaceRepository: repository })
  })

  it('saves a workspace and reloads identical data', async () => {
    await service.save(new Workspace(workspaceData))
    const loaded = await service.load(rootPath)
    expect(loaded.id).toBe('w-1')
  })

  it('throws NotFoundError when loading an unsaved root path', async () => {
    await expect(service.load(rootPath)).rejects.toThrow(NotFoundError)
  })
})
