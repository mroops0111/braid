import type { EmbeddingCoverage, GraphNode, NodeEmbedding, NodeId, WorkspaceId } from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { Embedder } from '../domain/embedding/Embedder.js'
import type { EmbeddingRepository } from '../domain/embedding/EmbeddingRepository.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import { embeddingTextFor, hashEmbeddingText } from './embeddingText.js'
import { cosineSimilarity } from './vectorSearch.js'

export interface EmbeddingServiceDeps {
  readonly modelRepository: ModelRepository
  readonly embeddingRepository: EmbeddingRepository
  readonly embedder: Embedder
  readonly clock: Clock
  readonly eventBus?: WorkspaceEventBus
  /** Nodes per progress event. Kept coarse so a rebuild does not flood the stream. */
  readonly progressEvery?: number
}

export interface SemanticHit {
  readonly nodeId: NodeId
  readonly score: number
}

const DEFAULT_PROGRESS_EVERY = 50

/**
 * Keeps a workspace's vectors in step with its nodes.
 *
 * Vectors are an index, not part of the model, so nothing here is required
 * for the graph to be correct. A workspace with no vectors answers every
 * structural query exactly as before and only loses semantic search.
 */
export class EmbeddingService {
  constructor(private readonly deps: EmbeddingServiceDeps) {}

  get modelId(): string {
    return this.deps.embedder.modelId
  }

  /** How much of the workspace a search would currently be able to see. */
  async coverage(workspaceId: WorkspaceId): Promise<EmbeddingCoverage> {
    const nodes = await this.deps.modelRepository.listNodes(workspaceId)
    const stored = await this.byNodeId(workspaceId)
    let current = 0
    for (const node of nodes) {
      if (this.isCurrent(stored.get(node.id), node))
        current += 1
    }
    return {
      total: nodes.length,
      current,
      stale: nodes.length - current,
      modelId: this.deps.embedder.modelId,
    }
  }

  /**
   * Bring every node's vector up to date, and drop vectors for nodes that
   * no longer exist. Skips a node whose text and model both still match,
   * so a rebuild after one apply costs one model call rather than a thousand.
   */
  async rebuild(workspaceId: WorkspaceId): Promise<EmbeddingCoverage> {
    const nodes = await this.deps.modelRepository.listNodes(workspaceId)
    const stored = await this.byNodeId(workspaceId)

    const live = new Set(nodes.map(node => node.id))
    const orphans = [...stored.keys()].filter(nodeId => !live.has(nodeId))
    if (orphans.length > 0)
      await this.deps.embeddingRepository.deleteMany(workspaceId, orphans)

    const outdated = nodes.filter(node => !this.isCurrent(stored.get(node.id), node))
    if (outdated.length === 0)
      return this.coverage(workspaceId)

    this.publish(workspaceId, { type: 'embedding.started', total: outdated.length })
    const every = this.deps.progressEvery ?? DEFAULT_PROGRESS_EVERY
    let done = 0
    try {
      for (const chunk of chunked(outdated, every)) {
        await this.embedAndStore(workspaceId, chunk)
        done += chunk.length
        this.publish(workspaceId, { type: 'embedding.progress', done, total: outdated.length })
      }
    }
    catch (err) {
      // A caller that started this detached has nowhere else to learn it broke,
      // and the vectors written before the failure stay valid.
      this.publish(workspaceId, { type: 'embedding.failed', message: messageOf(err) })
      throw err
    }
    this.publish(workspaceId, { type: 'embedding.completed', total: outdated.length })
    return this.coverage(workspaceId)
  }

  /**
   * Rank nodes by similarity to a query, best first.
   *
   * Only vectors that still match their node's text take part. A restore
   * rewinds the graph without touching this index, so a vector left over
   * from newer text would rank a node by words it no longer has. Ranking on
   * fewer nodes is recoverable, ranking on text that does not exist is not.
   */
  async search(workspaceId: WorkspaceId, query: string, limit: number): Promise<SemanticHit[]> {
    const nodes = await this.deps.modelRepository.listNodes(workspaceId)
    const stored = await this.byNodeId(workspaceId)
    const usable = nodes
      .map(node => ({ node, embedding: stored.get(node.id) }))
      .filter((pair): pair is { node: GraphNode, embedding: NodeEmbedding } =>
        pair.embedding !== undefined && this.isCurrent(pair.embedding, pair.node))
    if (usable.length === 0)
      return []
    const [queryVector] = await this.deps.embedder.embed([query])
    if (!queryVector)
      return []
    return usable
      .map(({ embedding }) => ({
        nodeId: embedding.nodeId,
        score: cosineSimilarity(queryVector, embedding.vector),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
  }

  private async embedAndStore(workspaceId: WorkspaceId, nodes: readonly GraphNode[]): Promise<void> {
    const texts = nodes.map(embeddingTextFor)
    const vectors = await this.deps.embedder.embed(texts)
    const createdAt = this.deps.clock.now()
    const embeddings: NodeEmbedding[] = nodes.map((node, index) => ({
      nodeId: node.id,
      vector: vectors[index] ?? [],
      modelId: this.deps.embedder.modelId,
      sourceHash: hashEmbeddingText(texts[index] ?? ''),
      createdAt,
    }))
    await this.deps.embeddingRepository.putMany(workspaceId, embeddings)
  }

  private async byNodeId(workspaceId: WorkspaceId): Promise<Map<NodeId, NodeEmbedding>> {
    const stored = await this.deps.embeddingRepository.list(workspaceId)
    return new Map(stored.map(entry => [entry.nodeId, entry]))
  }

  /**
   * A stored vector still stands when it came from this model,
   * and from text that has not moved since.
   */
  private isCurrent(stored: NodeEmbedding | undefined, node: GraphNode): boolean {
    if (!stored || stored.modelId !== this.deps.embedder.modelId)
      return false
    return stored.sourceHash === hashEmbeddingText(embeddingTextFor(node))
  }

  private publish(workspaceId: WorkspaceId, event: EmbeddingProgress): void {
    this.deps.eventBus?.publish({
      ...event,
      workspaceId,
      at: this.deps.clock.now(),
    })
  }
}

type EmbeddingProgress =
  | { type: 'embedding.started', total: number }
  | { type: 'embedding.progress', done: number, total: number }
  | { type: 'embedding.completed', total: number }
  | { type: 'embedding.failed', message: string }

function messageOf(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.length > 0 ? message : 'embedding failed'
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size))
  return out
}
