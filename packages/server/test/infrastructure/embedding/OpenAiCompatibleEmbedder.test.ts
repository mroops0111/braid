import { describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleEmbedder } from '../../../src/infrastructure/embedding/OpenAiCompatibleEmbedder.js'

function rows(vectors: number[][]): { data: { embedding: number[], index: number }[] } {
  return { data: vectors.map((embedding, index) => ({ embedding, index })) }
}

function respondWith(body: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof globalThis.fetch
}

function makeEmbedder(
  fetchImpl: typeof globalThis.fetch,
  extra: { batchSize?: number, apiKey?: string } = {},
): OpenAiCompatibleEmbedder {
  return new OpenAiCompatibleEmbedder({
    host: 'http://ollama:11434',
    model: 'bge-m3:latest',
    batchSize: extra.batchSize ?? 16,
    timeoutMs: 1000,
    fetch: fetchImpl,
    ...(extra.apiKey ? { apiKey: extra.apiKey } : {}),
  })
}

describe('openAiCompatibleEmbedder', () => {
  it('reports the model it was configured with, since a vector is only comparable within one', () => {
    expect(makeEmbedder(respondWith(rows([]))).modelId).toBe('bge-m3:latest')
  })

  it('returns one vector per text', async () => {
    const embedder = makeEmbedder(respondWith(rows([[0.1, 0.2], [0.3, 0.4]])))
    expect(await embedder.embed(['a', 'b'])).toEqual([[0.1, 0.2], [0.3, 0.4]])
  })

  it('calls the shape every provider shares, so one client reaches all of them', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(url)
      return new Response(JSON.stringify(rows([[0.1]])), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    await makeEmbedder(fetchImpl).embed(['a'])
    expect(seen).toEqual(['http://ollama:11434/v1/embeddings'])
  })

  // A self-hosted server wants no key.
  // An empty bearer is worse than none, since some servers reject it.
  it('omits the authorization header when no key is configured', async () => {
    const headers: (string | null)[] = []
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      headers.push(new Headers(init.headers).get('authorization'))
      return new Response(JSON.stringify(rows([[0.1]])), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    await makeEmbedder(fetchImpl).embed(['a'])
    expect(headers).toEqual([null])
  })

  it('sends the key as a bearer token where one is configured', async () => {
    const headers: (string | null)[] = []
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      headers.push(new Headers(init.headers).get('authorization'))
      return new Response(JSON.stringify(rows([[0.1]])), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    await makeEmbedder(fetchImpl, { apiKey: 'sk-test' }).embed(['a'])
    expect(headers).toEqual(['Bearer sk-test'])
  })

  it('splits a long input into batches, so one request never carries a whole graph', async () => {
    const calls: string[][] = []
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] }
      calls.push(body.input)
      return new Response(JSON.stringify(rows(body.input.map(() => [0.1]))), { status: 200 })
    }) as unknown as typeof globalThis.fetch

    await makeEmbedder(fetchImpl, { batchSize: 2 }).embed(['a', 'b', 'c'])
    expect(calls).toEqual([['a', 'b'], ['c']])
  })

  // Some servers answer out of order and say so in `index`.
  // Trusting arrival order would pair each node with another node's meaning,
  // which no later check would catch.
  it('places each vector by the index the server reports, not by arrival', async () => {
    const outOfOrder = {
      data: [
        { embedding: [0.3], index: 1 },
        { embedding: [0.1], index: 0 },
      ],
    }
    const embedder = makeEmbedder(respondWith(outOfOrder))
    expect(await embedder.embed(['first', 'second'])).toEqual([[0.1], [0.3]])
  })

  it('names the server and model when the call is refused', async () => {
    const embedder = makeEmbedder(respondWith({}, 404))
    await expect(embedder.embed(['a'])).rejects.toThrow(/http:\/\/ollama:11434 replied 404.*bge-m3:latest/)
  })

  it('rejects a reply that carries a different number of vectors than texts', async () => {
    const embedder = makeEmbedder(respondWith(rows([[0.1]])))
    await expect(embedder.embed(['a', 'b'])).rejects.toThrow(/1 vectors for 2 texts/)
  })

  it('rejects a malformed vector rather than storing it', async () => {
    const embedder = makeEmbedder(respondWith({ data: [{ embedding: ['no'], index: 0 }] }))
    await expect(embedder.embed(['a'])).rejects.toThrow(/malformed vector/)
  })

  it('reports the address when the server cannot be reached at all', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof globalThis.fetch
    await expect(makeEmbedder(fetchImpl).embed(['a'])).rejects.toThrow(/http:\/\/ollama:11434 did not answer/)
  })
})
