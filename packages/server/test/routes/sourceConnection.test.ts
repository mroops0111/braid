import type { WorkspaceService } from '@braidhq/core'
import type { SecretStore } from '../../src/infrastructure/secrets/SecretStore.js'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { workspaceIdMiddleware } from '../../src/middleware/workspaceId.js'
import { createSourceConnectionRouter } from '../../src/routes/sourceConnection.js'

interface FakeSource { id: string, name: string, kind: string, loader?: { kind: string } }

function appWith(records: Record<string, unknown>, sources: FakeSource[] = []): Hono {
  const store: SecretStore = {
    read: async <T>(ns: string, key: string) => records[`${ns}/${key}`] as T | undefined,
    write: async () => {},
    delete: async () => {},
  }
  const workspaceService = {
    findById: async () => ({ productManifest: { sources } }),
  } as unknown as WorkspaceService
  const app = new Hono()
  app.use('/workspaces/:workspaceId/*', workspaceIdMiddleware)
  app.route('/workspaces/:workspaceId/source-connections', createSourceConnectionRouter({ secretStore: store, workspaceService }))
  return app
}

describe('createSourceConnectionRouter', () => {
  it('reports not connected when no credential is stored', async () => {
    const res = await appWith({}).request('/workspaces/ws1/source-connections/src1')
    expect(await res.json()).toEqual({ connected: false, needsAuth: false })
  })

  it('reports a github connection with who linked it', async () => {
    const res = await appWith({
      'oauth-github/ws1--src1': { accessToken: 'x', connectedBy: { userId: 'u1', displayName: 'Ada' }, connectedAt: '2026-01-01T00:00:00Z' },
    }).request('/workspaces/ws1/source-connections/src1')
    expect(await res.json()).toEqual({ connected: true, needsAuth: false, connectedBy: { userId: 'u1', displayName: 'Ada' }, connectedAt: '2026-01-01T00:00:00Z' })
  })

  it('reports needsAuth when a stored credential has gone stale', async () => {
    const res = await appWith({
      'oauth-google/ws1--src1': { accessToken: 'x', needsAuth: true, connectedBy: { userId: 'u1', displayName: 'Ada' } },
    }).request('/workspaces/ws1/source-connections/src1')
    const body = await res.json() as { connected: boolean, needsAuth: boolean }
    expect(body).toMatchObject({ connected: true, needsAuth: true })
  })

  it('lists only OAuth-backed sources, flagging the stale one', async () => {
    const res = await appWith(
      { 'oauth-google/ws1--prd': { accessToken: 'x', needsAuth: true, connectedBy: { userId: 'u1', displayName: 'Ada' } } },
      [
        { id: 'prd', name: 'prd', kind: 'filesystem', loader: { kind: 'gdrive' } },
        { id: 'code', name: 'app', kind: 'filesystem', loader: { kind: 'git' } },
      ],
    ).request('/workspaces/ws1/source-connections')
    const body = await res.json() as { connections: Array<{ sourceId: string, needsAuth: boolean }> }
    expect(body.connections).toHaveLength(1)
    expect(body.connections[0]).toMatchObject({ sourceId: 'prd', name: 'prd', connected: true, needsAuth: true })
  })
})
