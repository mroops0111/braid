import { z } from 'zod'
import { NodeId, PluginId, Timestamp } from './common.js'

export const EmbeddingKind = z.string().min(1).brand<'EmbeddingKind'>()
export type EmbeddingKind = z.infer<typeof EmbeddingKind>

export const EmbeddingDescriptor = z.object({
  kind: EmbeddingKind,
  pluginId: PluginId.optional(),
  config: z.unknown(),
})
export type EmbeddingDescriptor = z.infer<typeof EmbeddingDescriptor>

/**
 * One node's vector, held apart from the node itself.
 *
 * A vector is derived from the node's text, the way a search index is derived
 * from a corpus, so it lives outside the versioned model and is rebuilt rather
 * than restored. Storing it on the node would put 1024 floats per node into
 * every revision of a file that is committed on each apply.
 */
export const NodeEmbedding = z.object({
  nodeId: NodeId,
  vector: z.array(z.number()).min(1),
  /**
   * Which model produced it. Vectors from different models share no space,
   * so a change here invalidates the corpus rather than mixing with it.
   */
  modelId: z.string().min(1),
  /**
   * SHA-256 of the text that was embedded.
   * Lets a rebuild skip a node whose words have not moved,
   * which is most of them on any given apply.
   */
  sourceHash: z.string().min(1),
  createdAt: Timestamp,
})
export type NodeEmbedding = z.infer<typeof NodeEmbedding>

/** How much of a workspace currently has a usable vector. */
export const EmbeddingCoverage = z.object({
  total: z.number().int().nonnegative(),
  current: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  modelId: z.string().min(1).nullable(),
})
export type EmbeddingCoverage = z.infer<typeof EmbeddingCoverage>
