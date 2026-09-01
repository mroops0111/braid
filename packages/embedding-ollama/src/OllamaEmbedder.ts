import type { Embedder } from '@braidhq/core'

export interface OllamaEmbedderOptions {
  /** Base URL of the Ollama server, without a trailing slash. */
  readonly host: string
  /** Model tag as Ollama knows it, e.g. `bge-m3:latest`. */
  readonly model: string
  /**
   * How many texts go in one request.
   * A whole graph in one call would sit in memory on both sides,
   * and a failure would lose the entire pass rather than one batch.
   */
  readonly batchSize: number
  /**
   * Milliseconds before a batch is abandoned.
   * The first call after a cold start pays for loading the model,
   * which on a large model is far longer than any later call.
   */
  readonly timeoutMs: number
  readonly fetch?: typeof globalThis.fetch
}

interface EmbedResponse {
  readonly embeddings?: unknown
}

/**
 * Embeds through an Ollama server.
 *
 * Ollama is already a common part of a self-hosted stack, and it keeps the
 * model outside the Braid image and the text inside the host.
 */
export class OllamaEmbedder implements Embedder {
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(private readonly options: OllamaEmbedderOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  get modelId(): string {
    return this.options.model
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const out: number[][] = []
    for (let start = 0; start < texts.length; start += this.options.batchSize) {
      const batch = texts.slice(start, start + this.options.batchSize)
      out.push(...await this.embedBatch(batch))
    }
    return out
  }

  private async embedBatch(batch: readonly string[]): Promise<number[][]> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.options.host}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.options.model, input: batch }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    }
    catch (err) {
      throw new Error(`Ollama at ${this.options.host} did not answer: ${describe(err)}`)
    }
    if (!response.ok)
      throw new Error(`Ollama at ${this.options.host} replied ${response.status} for model "${this.options.model}"`)

    const body = await response.json() as EmbedResponse
    const vectors = body.embeddings
    if (!Array.isArray(vectors) || vectors.length !== batch.length)
      throw new Error(`Ollama returned ${describeCount(vectors)} for ${batch.length} texts`)
    return vectors.map((vector, index) => {
      if (!Array.isArray(vector) || vector.length === 0 || vector.some(value => typeof value !== 'number'))
        throw new Error(`Ollama returned a malformed vector at position ${index}`)
      return vector as number[]
    })
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

function describeCount(vectors: unknown): string {
  return Array.isArray(vectors) ? `${vectors.length} vectors` : 'no vectors'
}
