import type { CommitMeta, CommitSha, EdgeId, FileDiff, GraphEdge, GraphNode, ModelSnapshot, NodeId, NodeTypeId, TagMeta, WorkspaceId } from '@braidhq/schema'
import type { GraphSerializer } from '../../src/domain/model/GraphSerializer.js'
import type { ListCommitsOptions, Workspace, WorkspaceHistory } from '../../src/index.js'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryModelRepository, WorkspaceBootstrap } from '../../src/index.js'

const WORKSPACE_ID = 'ws-1' as WorkspaceId

function makeWorkspace(): Workspace {
  return {
    id: WORKSPACE_ID,
    rootPath: '/tmp/fake-workspace',
  } as unknown as Workspace
}

function makeNode(id: string): GraphNode {
  return {
    id: id as NodeId,
    type: 'aggregate' as NodeTypeId,
    name: id,
    status: 'draft',
    metadata: { sourceReferences: [] },
  }
}

function makeEdge(id: string, from: string, to: string): GraphEdge {
  return {
    id: id as EdgeId,
    type: 'contains' as never,
    fromNodeId: from as NodeId,
    toNodeId: to as NodeId,
    metadata: { sourceReferences: [] },
  }
}

class FakeWorkspaceHistory implements WorkspaceHistory {
  readonly ensureInitialised = vi.fn(async (_workspace: Workspace): Promise<void> => {})
  readonly commit = vi.fn(async (): Promise<CommitSha> => '0'.repeat(40) as CommitSha)
  readonly listCommits = vi.fn(async (_ws: Workspace, _opts?: ListCommitsOptions): Promise<readonly CommitMeta[]> => [])
  readonly getCommit = vi.fn(async (): Promise<CommitMeta | null> => null)
  readonly getCommitDiff = vi.fn(async (): Promise<readonly FileDiff[]> => [])
  readonly readGraphAtCommit = vi.fn(async (): Promise<ModelSnapshot> => ({ nodes: [], edges: [] }))
  readonly restore = vi.fn(async (): Promise<CommitSha> => '0'.repeat(40) as CommitSha)
  readonly tag = vi.fn(async (): Promise<TagMeta> => ({ name: '', sha: '0'.repeat(40) as CommitSha, createdAt: new Date().toISOString() as never }))
  readonly listTags = vi.fn(async (): Promise<readonly TagMeta[]> => [])
  readonly deleteTag = vi.fn(async (): Promise<void> => {})
}

class FakeGraphSerializer implements GraphSerializer {
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
  history: FakeWorkspaceHistory
  serializer: FakeGraphSerializer
  modelRepository: InMemoryModelRepository
  bootstrap: WorkspaceBootstrap
}

function setup(): Setup {
  const workspace = makeWorkspace()
  const history = new FakeWorkspaceHistory()
  const serializer = new FakeGraphSerializer()
  const modelRepository = new InMemoryModelRepository()
  const bootstrap = new WorkspaceBootstrap({ history, serializer, modelRepository })
  return { workspace, history, serializer, modelRepository, bootstrap }
}

describe('WorkspaceBootstrap', () => {
  it('always calls history.ensureInitialised so a fresh workspace lands as a git repo', async () => {
    const { workspace, history, bootstrap } = setup()

    await bootstrap.ensure(workspace)

    expect(history.ensureInitialised).toHaveBeenCalledWith(workspace)
  })

  it('hydrates the backend from graph.json when the backend is empty and disk has data', async () => {
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

  it('dumps the backend to graph.json when the backend has data and disk is empty', async () => {
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
})
