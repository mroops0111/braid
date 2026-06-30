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
      // DDD ontology requires both intent + code roles. Use minimal
      // filesystem sources so the scaffold passes its role check; the
      // batch tests don't exercise loader-driven ingest.
      body: JSON.stringify({
        name: 'bt',
        manifest: {
          name: 'bt',
          sources: [
            { kind: 'filesystem', id: 'intent', role: 'intent', name: 'intent', path: './intent' },
            { kind: 'filesystem', id: 'code', role: 'code', name: 'code', path: './code' },
          ],
        },
      }),
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

  // NOTE: the previous "POST /batch returns 400 when no sources" case is
  // now blocked upstream by the scaffold endpoint's `requiredSourceRoles`
  // check on the DDD ontology (`['intent', 'code']`). A workspace
  // without both roles cannot be created in the first place. See
  // packages/server/src/routes/workspaces.ts in the scaffold handler.

  it('POST /batch/stop is idempotent (204 even when no batch running)', async () => {
    const response = await app.request(`/workspaces/${workspaceId}/batch/stop`, { method: 'POST' })
    expect(response.status).toBe(204)
  })

  it('POST /batch/archive returns 400 when no plan exists', async () => {
    const response = await app.request(`/workspaces/${workspaceId}/batch/archive`, { method: 'POST' })
    expect(response.status).toBe(400)
    const body = await readJson<{ detail: string }>(response)
    expect(body.detail).toMatch(/No batch plan/)
  })
})
