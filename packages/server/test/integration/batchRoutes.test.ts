import type { OpenAPIHono } from '@hono/zod-openapi'
import type { AppDependencies } from '../../src/composition.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeFsApp } from '../../src/composeFs.js'
import { readJson } from '../helpers/readJson.js'

describe('batch REST routes', () => {
  let braidHome: string
  let deps: AppDependencies
  let app: OpenAPIHono
  let workspaceId: string

  beforeEach(async () => {
    braidHome = await mkdtemp(join(tmpdir(), 'braid-batch-routes-'))
    deps = await composeFsApp({ braidHome })
    app = createApp(deps)
    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bt', manifest: { name: 'bt', sources: [] } }),
    })
    workspaceId = (await readJson<{ workspace: { id: string } }>(response)).workspace.id
  })

  afterEach(async () => {
    await rm(braidHome, { recursive: true, force: true }).catch(() => {})
  })

  it('GET /batch returns 404 when no plan exists', async () => {
    const response = await app.request(`/workspaces/${workspaceId}/batch`)
    expect(response.status).toBe(404)
  })

  it('POST /batch returns 400 when the workspace has no sources', async () => {
    const response = await app.request(`/workspaces/${workspaceId}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoApply: false }),
    })
    expect(response.status).toBe(400)
    const body = await readJson<{ detail: string }>(response)
    expect(body.detail).toMatch(/no intent or code sources/)
  })

  it('POST /batch/stop is idempotent (204 even when no batch running)', async () => {
    const response = await app.request(`/workspaces/${workspaceId}/batch/stop`, { method: 'POST' })
    expect(response.status).toBe(204)
  })
})
