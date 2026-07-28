import type { ModelSnapshot, WorkspaceId } from '@braidhq/schema'
import type { ModelSerializer } from '../../src/domain/model/ModelSerializer.js'
import type { Workspace } from '../../src/index.js'
import { makeEdge, makeNode, makeWorkspace } from '@braidhq/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryModelRepository } from '../../src/in-memory.js'
import { WorkspaceBootstrapService } from '../../src/index.js'
import { SpyWorkspaceHistory } from '../helpers/doubles.js'

const WORKSPACE_ID = 'ws-1' as WorkspaceId

class FakeModelSerializer implements ModelSerializer {
  private stored: ModelSnapshot | null = null
  readonly writeSpy = vi.fn()

  async write(_workspace: Workspace, snapshot: ModelSnapshot): Promise<void> {
    this.stored = { nodes: [...snapshot.nodes], edges: [...snapshot.edges] }
    this.writeSpy(snapshot)
  }

  async read(): Promise<ModelSnapshot | null> {
    return this.stored
  }

  async exists(): Promise<boolean> {
    return this.stored !== null
  }

  seed(snapshot: ModelSnapshot): void {
    this.stored = snapshot
  }
}

interface Setup {
  workspace: Workspace
  history: SpyWorkspaceHistory
  serializer: FakeModelSerializer
  modelRepository: InMemoryModelRepository
  bootstrap: WorkspaceBootstrapService
}

function setup(): Setup {
  const workspace = makeWorkspace({ id: 'ws-1' })
  const history = new SpyWorkspaceHistory()
  const serializer = new FakeModelSerializer()
  const modelRepository = new InMemoryModelRepository()
  const bootstrap = new WorkspaceBootstrapService({ history, serializer, modelRepository })
  return { workspace, history, serializer, modelRepository, bootstrap }
}

describe('WorkspaceBootstrapService', () => {
  it('always calls history.ensureInitialised so a fresh workspace lands as a git repo', async () => {
    const { workspace, history, bootstrap } = setup()

    await bootstrap.ensure(workspace)

    expect(history.ensureInitialised).toHaveBeenCalledWith(workspace)
  })

  it('hydrates the backend from model.json when the backend is empty and disk has data', async () => {
    const { workspace, serializer, modelRepository, bootstrap } = setup()
    const persisted: ModelSnapshot = {
      nodes: [makeNode('a'), makeNode('b')],
      edges: [makeEdge('e-1', 'a', 'b')],
    }
    serializer.seed(persisted)

    await bootstrap.ensure(workspace)

    const reloaded = await modelRepository.load(WORKSPACE_ID)
    expect(reloaded.nodes.map(n => n.id).sort()).toEqual(['a', 'b'])
    expect(reloaded.edges).toHaveLength(1)
  })

  it('dumps the backend to model.json when the backend has data and disk is empty', async () => {
    const { workspace, serializer, modelRepository, bootstrap } = setup()
    await modelRepository.applyOperations(WORKSPACE_ID, [
      { operation: 'addNodes', payloads: [makeNode('a')] },
    ])

    await bootstrap.ensure(workspace)

    const persisted = await serializer.read()
    expect(persisted).not.toBeNull()
    expect(persisted!.nodes.map(n => n.id)).toEqual(['a'])
  })

  it('is a no-op when both sides are empty (empty workspace stays empty)', async () => {
    const { workspace, serializer, modelRepository, bootstrap } = setup()

    await bootstrap.ensure(workspace)

    expect(await serializer.exists()).toBe(false)
    expect((await modelRepository.load(WORKSPACE_ID)).nodes).toHaveLength(0)
  })

  it('does not re-dump when both sides already agree', async () => {
    const { workspace, serializer, modelRepository, bootstrap } = setup()
    const snapshot: ModelSnapshot = { nodes: [makeNode('a')], edges: [] }
    serializer.seed(snapshot)
    await modelRepository.applyOperations(WORKSPACE_ID, [
      { operation: 'addNodes', payloads: snapshot.nodes },
    ])

    await bootstrap.ensure(workspace)

    expect(serializer.writeSpy).not.toHaveBeenCalled()
  })

  it('repeated calls are idempotent (no growth on the backend)', async () => {
    const { workspace, serializer, modelRepository, bootstrap } = setup()
    serializer.seed({ nodes: [makeNode('a')], edges: [] })

    await bootstrap.ensure(workspace)
    await bootstrap.ensure(workspace)

    const reloaded = await modelRepository.load(WORKSPACE_ID)
    expect(reloaded.nodes).toHaveLength(1)
  })

  describe('reloadStoreFromFile', () => {
    it('wipes the store and rehydrates from model.json', async () => {
      const { workspace, serializer, modelRepository, bootstrap } = setup()
      await modelRepository.applyOperations(WORKSPACE_ID, [
        { operation: 'addNodes', payloads: [makeNode('stale')] },
      ])
      serializer.seed({ nodes: [makeNode('a'), makeNode('b')], edges: [makeEdge('e-1', 'a', 'b')] })

      await bootstrap.reloadStoreFromFile(workspace)

      const reloaded = await modelRepository.load(WORKSPACE_ID)
      expect(reloaded.nodes.map(n => n.id).sort()).toEqual(['a', 'b'])
      expect(reloaded.edges).toHaveLength(1)
    })

    it('wipes the store to empty when model.json is absent', async () => {
      const { workspace, modelRepository, bootstrap } = setup()
      await modelRepository.applyOperations(WORKSPACE_ID, [
        { operation: 'addNodes', payloads: [makeNode('a'), makeNode('b')] },
        { operation: 'addEdges', payloads: [makeEdge('e-1', 'a', 'b')] },
      ])

      await bootstrap.reloadStoreFromFile(workspace)

      const reloaded = await modelRepository.load(WORKSPACE_ID)
      expect(reloaded.nodes).toHaveLength(0)
      expect(reloaded.edges).toHaveLength(0)
    })

    it('leaves the store empty when model.json holds an empty snapshot', async () => {
      const { workspace, serializer, modelRepository, bootstrap } = setup()
      serializer.seed({ nodes: [], edges: [] })

      await bootstrap.reloadStoreFromFile(workspace)

      expect((await modelRepository.load(WORKSPACE_ID)).nodes).toHaveLength(0)
    })
  })
})
