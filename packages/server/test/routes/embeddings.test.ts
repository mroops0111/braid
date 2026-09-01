import type { EmbeddingService } from '@braidhq/core'
import { OpenAPIHono } from '@hono/zod-openapi'
import { describe, expect, it, vi } from 'vitest'
import { workspaceIdMiddleware } from '../../src/middleware/workspaceId.js'
import { createEmbeddingsRouter } from '../../src/routes/embeddings.js'

/**
 * Mount the router where the app mounts it,
 * since the handlers read the workspace id from the context,
 * rather than from a raw param.
 */
function appWith(embeddingService?: EmbeddingService) {
  const app = new OpenAPIHono()
  app.use('/workspaces/:workspaceId/*', workspaceIdMiddleware)
  app.route('/workspaces/:workspaceId/embeddings', createEmbeddingsRouter(
    embeddingService ? { embeddingService } : {},
  ))
  return {
    request: (path: string, init?: RequestInit) => app.request(`/workspaces/ws/embeddings${path}`, init),
  }
}

const COVERAGE = { total: 10, current: 4, stale: 6, modelId: 'bge-m3:latest' }

describe('embeddings routes', () => {
  it('answers zero coverage when no backend is configured, rather than failing', async () => {
    const response = await appWith().request('')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ total: 0, current: 0, stale: 0, modelId: null })
  })

  it('accepts a rebuild with no backend, so a caller needs no capability check', async () => {
    const response = await appWith().request('/rebuild', { method: 'POST' })
    expect(response.status).toBe(202)
  })

  it('reports what the service knows', async () => {
    const service = { coverage: vi.fn(async () => COVERAGE) } as unknown as EmbeddingService
    const response = await appWith(service).request('')
    expect(await response.json()).toEqual(COVERAGE)
  })

  it('answers a rebuild immediately rather than waiting minutes for it', async () => {
    let settle: (() => void) | undefined
    const service = {
      coverage: vi.fn(async () => COVERAGE),
      rebuild: vi.fn(() => new Promise<void>((resolve) => {
        settle = resolve
      })),
    } as unknown as EmbeddingService

    const response = await appWith(service).request('/rebuild', { method: 'POST' })

    // Answered while the rebuild is still running, which is the whole point.
    expect(response.status).toBe(202)
    expect(settle).toBeDefined()
    settle?.()
  })

  it('does not let a failed rebuild reject into the request handler', async () => {
    const service = {
      coverage: vi.fn(async () => COVERAGE),
      rebuild: vi.fn(async () => {
        throw new Error('ollama is down')
      }),
    } as unknown as EmbeddingService

    await expect(appWith(service).request('/rebuild', { method: 'POST' })).resolves.toBeDefined()
  })
})
