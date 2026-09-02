import type { GraphNode, NodeEmbedding, NodeId, NodeTypeId, WorkspaceEvent, WorkspaceId } from '@braidhq/schema'
import type { Embedder } from '../../src/domain/embedding/Embedder.js'
import type { EmbeddingRepository } from '../../src/domain/embedding/EmbeddingRepository.js'
import type { ModelRepository } from '../../src/domain/model/ModelRepository.js'
import { FixedClock } from '@braidhq/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { EmbeddingService } from '../../src/application/EmbeddingService.js'

const WORKSPACE = 'ws' as WorkspaceId

function node(id: string, name: string, description?: string): GraphNode {
  return {
    id: id as NodeId,
    type: 'command' as NodeTypeId,
    name,
    status: 'draft',
    metadata: { sourceReferences: [] },
    ...(description ? { description } : {}),
  } as GraphNode
}

/** Records what it was asked to embed, so a test can assert what was skipped. */
function countingEmbedder(modelId = 'model-a'): Embedder & { seen: string[][] } {
  const seen: string[][] = []
  return {
    modelId,
    seen,
    embed: async (texts) => {
      seen.push([...texts])
      return texts.map((_, index) => [index + 1, 0, 0])
    },
  }
}

function memoryRepository(initial: NodeEmbedding[] = []): EmbeddingRepository {
  let rows = [...initial]
  return {
    list: async () => rows,
    putMany: async (_ws, embeddings) => {
      const incoming = new Set(embeddings.map(entry => entry.nodeId))
      rows = [...rows.filter(entry => !incoming.has(entry.nodeId)), ...embeddings]
    },
    deleteMany: async (_ws, nodeIds) => {
      const dropped = new Set(nodeIds)
      rows = rows.filter(entry => !dropped.has(entry.nodeId))
    },
  }
}

function modelRepositoryOf(nodes: GraphNode[]): ModelRepository & { replace: (next: GraphNode[]) => void } {
  let current = nodes
  return {
    listNodes: async () => current,
    replace: (next: GraphNode[]) => {
      current = next
    },
  } as unknown as ModelRepository & { replace: (next: GraphNode[]) => void }
}

function build(nodes: GraphNode[], stored: NodeEmbedding[] = [], embedder = countingEmbedder()) {
  const events: WorkspaceEvent[] = []
  const modelRepository = modelRepositoryOf(nodes)
  const service = new EmbeddingService({
    modelRepository,
    embeddingRepository: memoryRepository(stored),
    embedder,
    clock: new FixedClock(),
    eventBus: { publish: (event: WorkspaceEvent) => void events.push(event), subscribe: vi.fn() } as never,
    progressEvery: 2,
  })
  return { service, events, embedder, modelRepository }
}

describe('embeddingService', () => {
  it('embeds every node on a workspace that has none', async () => {
    const { service, embedder } = build([node('a', 'Apply Watermark'), node('b', 'Seal')])

    const coverage = await service.rebuild(WORKSPACE)

    expect(coverage).toMatchObject({ total: 2, current: 2, stale: 0 })
    expect(embedder.seen.flat()).toHaveLength(2)
  })

  it('embeds name and description together, since the words are mostly in the description', async () => {
    const { service, embedder } = build([node('a', 'Seal', 'Stamps a watermark on every page.')])

    await service.rebuild(WORKSPACE)

    expect(embedder.seen.flat()[0]).toContain('Stamps a watermark')
  })

  it('re-embeds only the node whose text moved, leaving its neighbours alone', async () => {
    const { service, embedder, modelRepository } = build([
      node('a', 'Apply', 'old words'),
      node('b', 'Seal', 'untouched'),
    ])
    await service.rebuild(WORKSPACE)
    embedder.seen.length = 0

    modelRepository.replace([
      node('a', 'Apply', 'new words'),
      node('b', 'Seal', 'untouched'),
    ])
    await service.rebuild(WORKSPACE)

    // Exactly the changed node, so the unchanged one cost no model call.
    expect(embedder.seen.flat()).toHaveLength(1)
    expect(embedder.seen.flat()[0]).toContain('new words')
  })

  it('embeds nothing at all when no text moved', async () => {
    const { service, embedder } = build([node('a', 'Apply'), node('b', 'Seal')])
    await service.rebuild(WORKSPACE)
    embedder.seen.length = 0

    await service.rebuild(WORKSPACE)

    expect(embedder.seen).toEqual([])
  })

  it('treats every vector as stale when the model changed, since the two share no space', async () => {
    const stored: NodeEmbedding[] = [{
      nodeId: 'a' as NodeId,
      vector: [1, 0, 0],
      modelId: 'model-from-before',
      sourceHash: 'whatever',
      createdAt: new FixedClock().now(),
    }]
    const { service } = build([node('a', 'Apply')], stored)

    expect((await service.coverage(WORKSPACE)).stale).toBe(1)
  })

  it('drops a vector whose node is gone, so a deleted node cannot be found', async () => {
    const stored: NodeEmbedding[] = [{
      nodeId: 'deleted' as NodeId,
      vector: [1, 0, 0],
      modelId: 'model-a',
      sourceHash: 'x',
      createdAt: new FixedClock().now(),
    }]
    const { service } = build([node('a', 'Apply')], stored)

    const coverage = await service.rebuild(WORKSPACE)

    expect(coverage.total).toBe(1)
    expect((await service.search(WORKSPACE, 'anything', 10)).map(hit => hit.nodeId)).not.toContain('deleted')
  })

  it('publishes progress so a viewer can see a rebuild is under way', async () => {
    const { service, events } = build([node('a', 'A'), node('b', 'B'), node('c', 'C')])

    await service.rebuild(WORKSPACE)

    expect(events.map(event => event.type)).toEqual([
      'embedding.started',
      'embedding.progress',
      'embedding.progress',
      'embedding.completed',
    ])
  })

  it('stays silent when nothing needed embedding', async () => {
    const { service, events } = build([node('a', 'A')])
    await service.rebuild(WORKSPACE)
    events.length = 0

    await service.rebuild(WORKSPACE)

    expect(events).toEqual([])
  })

  it('ranks a closer vector first', async () => {
    const { service } = build([node('a', 'A'), node('b', 'B')])
    await service.rebuild(WORKSPACE)

    const hits = await service.search(WORKSPACE, 'query', 10)

    expect(hits).toHaveLength(2)
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score)
  })

  it('leaves out a node whose text moved since it was embedded', async () => {
    const { service, modelRepository } = build([node('a', 'Apply', 'old words'), node('b', 'Seal')])
    await service.rebuild(WORKSPACE)

    // A restore rewinds the graph without touching the index,
    // so the stored vector now describes text the node no longer has.
    modelRepository.replace([node('a', 'Apply', 'reverted words'), node('b', 'Seal')])

    const hits = await service.search(WORKSPACE, 'query', 10)
    expect(hits.map(hit => hit.nodeId)).toEqual(['b'])
  })

  it('answers nothing at all when every vector went stale', async () => {
    const { service, modelRepository } = build([node('a', 'Apply', 'old words')])
    await service.rebuild(WORKSPACE)
    modelRepository.replace([node('a', 'Apply', 'reverted words')])

    expect(await service.search(WORKSPACE, 'query', 10)).toEqual([])
  })

  it('answers nothing when the workspace has no comparable vectors', async () => {
    const { service } = build([node('a', 'A')])

    expect(await service.search(WORKSPACE, 'query', 10)).toEqual([])
  })
})
