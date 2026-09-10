import { afterEach, describe, expect, it } from 'vitest'
import { buildRunnerApp, endAllSpawned } from '../helpers/runnerApp.js'

async function buildApp(stdoutLines: string[] = []) {
  return buildRunnerApp({
    spawns: stdoutLines.length > 0 ? [{ stdoutLines, exitCode: 0 }] : [],
  })
}

describe('skill routes', () => {
  afterEach(endAllSpawned)

  it('GET /workspaces/:ws/skills returns the registered manifests', async () => {
    const { app, workspace } = await buildApp()

    const response = await app.request(`/workspaces/${workspace.id}/skills`)

    expect(response.status).toBe(200)
    const body = await response.json() as { items: Array<{ id: string }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.id).toBe('braid:ask')
  })

  it('POST /workspaces/:ws/skills/:id/run accepts the request and returns a fresh run id', async () => {
    const { app, workspace } = await buildApp([JSON.stringify({ type: 'text', text: 'hello' })])

    const response = await app.request(`/workspaces/${workspace.id}/skills/braid:ask/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: 'what is voidTask' }),
    })

    expect(response.status).toBe(202)
    const body = await response.json() as { runId: string }
    expect(typeof body.runId).toBe('string')
    expect(body.runId.length).toBeGreaterThan(0)
  })

  it('returns 404 when the workspace is not registered', async () => {
    const { app } = await buildApp()

    const response = await app.request('/workspaces/missing-ws/skills')

    expect(response.status).toBe(404)
  })
})
