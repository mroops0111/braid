import type { EmbeddingPlugin, PluginContext } from '@braidhq/core'
import type { EmbeddingDescriptor } from '@braidhq/schema'
import { EmbeddingKind, PluginId } from '@braidhq/schema'
import { z } from 'zod'
import { OllamaEmbedder } from './OllamaEmbedder.js'

const OllamaEmbeddingConfig = z.object({
  host: z.string().min(1).default('http://localhost:11434'),
  model: z.string().min(1).default('bge-m3:latest'),
  batchSize: z.number().int().positive().default(16),
  // A cold Ollama loads the model on the first call,
  // which on a multi-gigabyte model outlasts any default HTTP timeout.
  timeoutMs: z.number().int().positive().default(300_000),
})

export class OllamaEmbeddingPlugin implements EmbeddingPlugin {
  readonly id = PluginId.parse('braid.embedding.ollama')
  readonly type = 'embedding' as const
  readonly kind = EmbeddingKind.parse('ollama')
  readonly configSchema = OllamaEmbeddingConfig

  async createEmbedder(descriptor: EmbeddingDescriptor, _context: PluginContext): Promise<OllamaEmbedder> {
    const config = OllamaEmbeddingConfig.parse(descriptor.config ?? {})
    return new OllamaEmbedder({
      ...config,
      host: config.host.replace(/\/$/, ''),
    })
  }
}
