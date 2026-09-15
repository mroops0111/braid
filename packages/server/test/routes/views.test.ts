import type { GenerateViewInput, ViewService } from '@braidhq/core'
import type { EmittedBlock, GeneratedView, GenerateViewResponse, ViewContent } from '@braidhq/schema'
import { NotFoundError, ValidationError } from '@braidhq/core'
import { FIXTURE_FORM, FIXTURE_FORMAT, FIXTURE_KIND, makeGeneratedView, makeViewForm, makeViewKind } from '@braidhq/test-utils'
import { OpenAPIHono } from '@hono/zod-openapi'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../../src/middleware/error.js'
import { workspaceIdMiddleware } from '../../src/middleware/workspaceId.js'
import { createViewKindsRouter } from '../../src/routes/viewKinds.js'
import { createViewsRouter } from '../../src/routes/views.js'

const BLOCK: EmittedBlock = {
  id: 'b-1' as EmittedBlock['id'],
  block: { call: 'showAnswer', markdown: 'the opening passage', audiences: [] },
}

const VIEW: GeneratedView = makeGeneratedView({ subject: 'ctx.checkout', bytes: 12 })

const UNDER = `${FIXTURE_KIND}/${FIXTURE_FORM}`
const MATERIAL = `artifacts/material/${FIXTURE_KIND}/ctx.checkout.json`

function viewService(overrides: Partial<ViewService> = {}): ViewService {
  return {
    kinds: () => [makeViewKind({
      subjects: [{ by: 'container' }],
      forms: [makeViewForm({ label: 'Form A' })],
    })],
    list: async () => [VIEW],
    read: async (): Promise<ViewContent> => ({ path: VIEW.path, format: VIEW.format, blocks: [BLOCK] }),
    generate: async (): Promise<GenerateViewResponse> => ({
      runId: 'run-1',
      form: VIEW.form,
      asked: {},
      material: MATERIAL,
    }),
    ...overrides,
  } as unknown as ViewService
}

function app(service: ViewService) {
  const scoped = new OpenAPIHono()
  scoped.use('*', workspaceIdMiddleware)
  scoped.route('/views', createViewsRouter({ viewService: service }))
  const root = new OpenAPIHono()
  root.onError(errorHandler)
  root.route('/workspaces/:workspaceId', scoped)
  root.route('/view-kinds', createViewKindsRouter({ viewService: service }))
  return root
}

describe('GET /view-kinds', () => {
  it('offers every form a surface could ask for, with what each one writes', async () => {
    const response = await app(viewService()).request('/view-kinds')
    const body = await response.json() as { items: { kind: string, forms: { id: string, format: string }[] }[] }
    expect(body.items[0]?.kind).toBe(FIXTURE_KIND)
    expect(body.items[0]?.forms[0]).toMatchObject({ id: FIXTURE_FORM, format: FIXTURE_FORMAT })
  })
})

describe('GET /workspaces/:id/views', () => {
  it('lists a document by the subject it was written out of', async () => {
    const response = await app(viewService()).request('/workspaces/ws-1/views')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [VIEW] })
  })
})

describe('GET /workspaces/:id/views/:kind/:form/:name', () => {
  it('answers with the blocks and the declared format', async () => {
    const response = await app(viewService()).request(`/workspaces/ws-1/views/${UNDER}/ctx.checkout.${FIXTURE_FORMAT}`)
    expect(await response.json()).toEqual({ path: VIEW.path, format: FIXTURE_FORMAT, blocks: [BLOCK] })
  })

  it('has no route at all for a name carrying a separator', async () => {
    const response = await app(viewService()).request(`/workspaces/ws-1/views/${UNDER}/a/b.${FIXTURE_FORMAT}`)
    expect(response.status).toBe(404)
  })

  it('answers 404 for a view nothing has written', async () => {
    const service = viewService({
      read: async () => { throw new NotFoundError(`No view at "${UNDER}/gone.${FIXTURE_FORMAT}"`) },
    })
    const response = await app(service).request(`/workspaces/ws-1/views/${UNDER}/gone.${FIXTURE_FORMAT}`)
    expect(response.status).toBe(404)
  })
})

describe('POST /workspaces/:id/views', () => {
  it('hands back the run writing the document rather than waiting on it', async () => {
    const generate = vi.fn(async (_input: GenerateViewInput) => ({
      runId: 'run-1',
      form: VIEW.form,
      asked: { depth: 'standard' },
      material: MATERIAL,
    }))
    const response = await app(viewService({ generate })).request('/workspaces/ws-1/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: FIXTURE_KIND, form: 'form-b', subject: 'ctx.checkout', asked: { depth: 'deep' } }),
    })

    expect(response.status).toBe(202)
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      kind: FIXTURE_KIND,
      form: 'form-b',
      subject: 'ctx.checkout',
      asked: { depth: 'deep' },
    }))
  })

  it('answers 400 for a form the generator does not ship', async () => {
    const service = viewService({
      generate: async () => { throw new ValidationError(`A "${FIXTURE_KIND}" view is written in one of ${FIXTURE_FORM}`) },
    })
    const response = await app(service).request('/workspaces/ws-1/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: FIXTURE_KIND, form: 'absent', subject: 'ctx.checkout' }),
    })
    expect(response.status).toBe(400)
  })
})
