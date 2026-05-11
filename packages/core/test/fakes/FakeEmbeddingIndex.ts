import type { Embedding, NodeId } from '@telos/schema'
import type { EmbeddingIndex } from '../../src/index.js'

export class FakeEmbeddingIndex implements EmbeddingIndex {
  private nextSearchResult: NodeId[] = []

  setNextSearchResult(nodeIds: NodeId[]): void {
    this.nextSearchResult = nodeIds
  }

  async upsert(_nodeId: NodeId, _embedding: Embedding): Promise<void> {}
  async upsertMany(_entries: { nodeId: NodeId, embedding: Embedding }[]): Promise<void> {}

  async search(): Promise<NodeId[]> {
    const result = this.nextSearchResult
    this.nextSearchResult = []
    return result
  }
}
