import type { Embedding, GraphNodeFilter, NodeId } from '@telos/schema'

export interface EmbeddingIndex {
  upsert: (nodeId: NodeId, embedding: Embedding) => Promise<void>
  upsertMany: (entries: { nodeId: NodeId, embedding: Embedding }[]) => Promise<void>
  search: (queryVector: Float32Array, topK: number, filter?: GraphNodeFilter) => Promise<NodeId[]>
}
