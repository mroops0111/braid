import type { NodeEmbedding, NodeId, WorkspaceId } from '@braidhq/schema'

/**
 * Where a workspace's vectors live.
 *
 * Kept apart from the model repository on purpose. A vector is derived from
 * the node's text the way an index is derived from a corpus, so it is rebuilt
 * rather than restored, and it never enters the versioned model file.
 */
export interface EmbeddingRepository {
  list: (workspaceId: WorkspaceId) => Promise<readonly NodeEmbedding[]>
  putMany: (workspaceId: WorkspaceId, embeddings: readonly NodeEmbedding[]) => Promise<void>
  deleteMany: (workspaceId: WorkspaceId, nodeIds: readonly NodeId[]) => Promise<void>
}
