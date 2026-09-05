import type { Embedder } from '@braidhq/core'

export interface OpenAiCompatibleEmbedderOptions {
  /** Base URL of the embedding server, without a trailing slash. */
  readonly host: string
  /** Model name as that server knows it, e.g. `bge-m3:latest`. */
  readonly model: string
  /** Sent as a bearer token. Absent where a server wants none. */
  readonly apiKey?: string
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
  readonly data?: unknown
}

/**
 * Embeds through any server speaking the OpenAI embeddings shape.
 *
 * That shape is what the field converged on.
 * One client therefore reaches a self-hosted Ollama, vLLM, or LM Studio,
 * as well as a hosted provider.
 * Which one is a deployment concern, and all that varies is the address,
 * the model name, and whether a key is required.
 */
export class OpenAiCompatibleEmbedder implements Embedder {
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(private readonly options: OpenAiCompatibleEmbedderOptions) {
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
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.options.apiKey)
      headers.authorization = `Bearer ${this.options.apiKey}`

    let response: Response
    try {
      response = await this.fetchImpl(`${this.options.host}/v1/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: this.options.model, input: batch }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    }
    catch (err) {
      throw new Error(`Embedding server at ${this.options.host} did not answer: ${describe(err)}`)
    }
    if (!response.ok) {
      throw new Error(
        `Embedding server at ${this.options.host} replied ${response.status} `
        + `for model "${this.options.model}"`,
      )
    }

    const body = await response.json() as EmbedResponse
    return placeVectors(body.data, batch.length)
  }
}

/**
 * Puts each vector where the server said it belongs.
 *
 * Some servers answer out of order and report the position in `index`.
 * Trusting arrival order would pair a node with another node's meaning.
 * Every vector involved would still be well formed,
 * so no later check would catch it.
 */
function placeVectors(rows: unknown, expected: number): number[][] {
  if (!Array.isArray(rows) || rows.length !== expected)
    throw new Error(`Embedding server returned ${describeCount(rows)} for ${expected} texts`)

  const placed = Array.from<number[] | undefined>({ length: expected })
  for (let position = 0; position < rows.length; position++) {
    const row = rows[position] as { embedding?: unknown, index?: unknown }
    const at = typeof row?.index === 'number' ? row.index : position
    if (at < 0 || at >= expected)
      throw new Error(`Embedding server returned index ${at} outside the batch`)
    placed[at] = readVector(row?.embedding, at)
  }

  return placed.map((vector, at) => {
    if (!vector)
      throw new Error(`Embedding server returned no vector for position ${at}`)
    return vector
  })
}

function readVector(value: unknown, at: number): number[] {
  const malformed = !Array.isArray(value)
    || value.length === 0
    || value.some(entry => typeof entry !== 'number')
  if (malformed)
    throw new Error(`Embedding server returned a malformed vector at position ${at}`)
  return value as number[]
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

function describeCount(rows: unknown): string {
  return Array.isArray(rows) ? `${rows.length} vectors` : 'no vectors'
}
