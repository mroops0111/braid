import { describe, expect, it, vi } from 'vitest'
import { OllamaEmbedder } from '../src/OllamaEmbedder.js'

function respondWith(body: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof globalThis.fetch
}

function makeEmbedder(fetchImpl: typeof globalThis.fetch, batchSize = 16): OllamaEmbedder {
  return new OllamaEmbedder({
    host: 'http://ollama:11434',
    model: 'bge-m3:latest',
    batchSize,
    timeoutMs: 1000,
    fetch: fetchImpl,
  })
}

describe('ollamaEmbedder', () => {
  it('reports the model it was configured with, since a vector is only comparable within one', () => {
    expect(makeEmbedder(respondWith({})).modelId).toBe('bge-m3:latest')
  })

  it('returns one vector per text', async () => {
    const embedder = makeEmbedder(respondWith({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }))
    expect(await embedder.embed(['a', 'b'])).toEqual([[0.1, 0.2], [0.3, 0.4]])
  })

  it('splits a long input into batches, so one request never carries a whole graph', async () => {
    const calls: string[][] = []
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] }
      calls.push(body.input)
      return new Response(JSON.stringify({ embeddings: body.input.map(() => [0.1]) }), { status: 200 })
    }) as unknown as typeof globalThis.fetch

    await makeEmbedder(fetchImpl, 2).embed(['a', 'b', 'c'])

    expect(calls).toEqual([['a', 'b'], ['c']])
  })

  it('names the host when the server cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof globalThis.fetch
    await expect(makeEmbedder(fetchImpl).embed(['a']))
      .rejects
      .toThrow(/http:\/\/ollama:11434 did not answer/)
  })

  it('names the model when the server rejects the request', async () => {
    await expect(makeEmbedder(respondWith({ error: 'not found' }, 404)).embed(['a']))
      .rejects
      .toThrow(/replied 404 for model "bge-m3:latest"/)
  })

  it('refuses a reply with fewer vectors than texts, rather than silently misaligning them', async () => {
    await expect(makeEmbedder(respondWith({ embeddings: [[0.1]] })).embed(['a', 'b']))
      .rejects
      .toThrow(/returned 1 vectors for 2 texts/)
  })

  it('refuses a malformed vector', async () => {
    await expect(makeEmbedder(respondWith({ embeddings: [['not a number']] })).embed(['a']))
      .rejects
      .toThrow(/malformed vector at position 0/)
  })

  it('refuses an empty vector, which would match everything equally', async () => {
    await expect(makeEmbedder(respondWith({ embeddings: [[]] })).embed(['a']))
      .rejects
      .toThrow(/malformed vector at position 0/)
  })
})
