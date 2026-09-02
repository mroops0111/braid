import type { EmbeddingDescriptor, EmbeddingKind } from '@braidhq/schema'
import type { Embedder } from '../embedding/Embedder.js'
import type { Plugin, PluginContext } from './Plugin.js'

/**
 * Embedding backend port.
 *
 * A deployment picks one,
 * since a graph's vectors must all come from the same model to be comparable.
 * Which one is a deployment concern rather than a Braid concern,
 * so no backend is built in.
 */
export interface EmbeddingPlugin extends Plugin {
  readonly type: 'embedding'
  readonly kind: EmbeddingKind
  createEmbedder: (descriptor: EmbeddingDescriptor, context: PluginContext) => Promise<Embedder>
}
