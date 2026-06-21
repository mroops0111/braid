import type { AbsolutePath, LoaderKind, SourceId } from '@braidhq/schema'
import type { SecretStore } from '../../src/infrastructure/secrets/SecretStore.js'
import { createHmac } from 'node:crypto'
import { makeWorkspace } from '@braidhq/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composition.js'

const SOURCE_ID = 'issues' as SourceId
const OWNER = 'mroops0111'
const REPO = 'braid'

function makeInMemorySecretStore(): SecretStore & { dump: () => Map<string, unknown> } {
  const store = new Map<string, unknown>()
  return {
    async read<T>(namespace: string, key: string): Promise<T | undefined> {
      return store.get(`${namespace}::${key}`) as T | undefined
    },
    async write(namespace: string, key: string, value: unknown) {
      store.set(`${namespace}::${key}`, value)
    },
    async delete(namespace: string, key: string) {
      store.delete(`${namespace}::${key}`)
    },
    dump: () => store,
  }
}

function makeGithubSource() {
  return {
    kind: 'filesystem' as const,
    id: SOURCE_ID,
    role: 'intent' as const,
    name: 'issues',
    path: '/abs/ws/issues' as AbsolutePath,
    loader: {
      kind: 'github' as LoaderKind,
      config: { owner: OWNER, repo: REPO },
    },
  }
}

async function buildApp(opts: { withSecret?: string } = {}) {
  const workspace = makeWorkspace({ sources: [makeGithubSource()] })
  const secretStore = makeInMemorySecretStore()
  const deps = composeApp()
  deps.secretStore = secretStore
  await deps.workspaceRepository.save(workspace)

  // Replace the sourceLoaderRunner with a spy. The real one would try to
  // actually invoke the github plugin; tests only need to assert the
  // receiver dispatched the syncOne call.
  const syncOne = vi.fn().mockResolvedValue({
    sourceId: SOURCE_ID,
    new: [],
    changed: [],
    unchanged: [],
    orphaned: [],
  })
  deps.sourceLoaderRunner = { syncOne } as never

  if (opts.withSecret) {
    await secretStore.write('webhook-github', `${workspace.id}--${SOURCE_ID}`, {
      secret: opts.withSecret,
      createdAt: '2026-06-19T00:00:00.000Z',
    })
  }

  const app = createApp(deps, { apiUrl: 'https://braid.test' })
  return { app, workspace, secretStore, syncOne }
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

describe('POST /webhooks/github/:workspaceId/:sourceId (issue #30)', () => {
  it('returns 202 and triggers syncOne when the signature and repo match', async () => {
    const { app, workspace, syncOne } = await buildApp({ withSecret: 'super-secret' })
    const body = JSON.stringify({ repository: { full_name: `${OWNER}/${REPO}` }, action: 'opened' })

    const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues',
        'X-Hub-Signature-256': sign('super-secret', body),
      },
      body,
    })

    expect(response.status).toBe(202)
    // syncOne runs in the background; give the microtask queue a tick.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(syncOne).toHaveBeenCalledTimes(1)
    expect(syncOne.mock.calls[0]?.[1]).toBe(SOURCE_ID)
  })

  it('returns 401 and skips syncOne when the signature is invalid', async () => {
    const { app, workspace, syncOne } = await buildApp({ withSecret: 'super-secret' })
    const body = JSON.stringify({ repository: { full_name: `${OWNER}/${REPO}` } })

    const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': sign('wrong-secret', body),
      },
      body,
    })

    expect(response.status).toBe(401)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(syncOne).not.toHaveBeenCalled()
  })

  it('returns 400 and skips syncOne when the payload repository does not match the configured one', async () => {
    const { app, workspace, syncOne } = await buildApp({ withSecret: 'super-secret' })
    const body = JSON.stringify({ repository: { full_name: 'someone-else/other-repo' } })

    const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': sign('super-secret', body),
      },
      body,
    })

    expect(response.status).toBe(400)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(syncOne).not.toHaveBeenCalled()
  })

  it('returns 404 when no webhook secret has been provisioned for the source', async () => {
    const { app, workspace } = await buildApp()
    const body = JSON.stringify({ repository: { full_name: `${OWNER}/${REPO}` } })

    const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': sign('anything', body),
      },
      body,
    })

    expect(response.status).toBe(404)
  })
})

describe('GET /workspaces/:ws/source-webhooks/:sourceId/github', () => {
  it('reports hasSecret=false and the public URL when no secret has been provisioned', async () => {
    const { app, workspace } = await buildApp()

    const response = await app.request(`/workspaces/${workspace.id}/source-webhooks/${SOURCE_ID}/github`)
    expect(response.status).toBe(200)
    const body = await response.json() as { url: string, hasSecret: boolean, createdAt?: string }
    expect(body.url).toBe(`https://braid.test/webhooks/github/${workspace.id}/${SOURCE_ID}`)
    expect(body.hasSecret).toBe(false)
    expect(body.createdAt).toBeUndefined()
  })

  it('reports hasSecret=true and the createdAt timestamp without ever leaking the secret', async () => {
    const { app, workspace } = await buildApp({ withSecret: 'super-secret' })

    const response = await app.request(`/workspaces/${workspace.id}/source-webhooks/${SOURCE_ID}/github`)
    expect(response.status).toBe(200)
    const body = await response.json() as { url: string, hasSecret: boolean, createdAt?: string, secret?: string }
    expect(body.hasSecret).toBe(true)
    expect(body.createdAt).toBe('2026-06-19T00:00:00.000Z')
    expect(body.secret).toBeUndefined()
  })
})

describe('POST /workspaces/:ws/source-webhooks/:sourceId/github/rotate', () => {
  it('returns a freshly generated secret + url and persists it to the store', async () => {
    const { app, workspace, secretStore } = await buildApp()

    const response = await app.request(`/workspaces/${workspace.id}/source-webhooks/${SOURCE_ID}/github/rotate`, {
      method: 'POST',
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { url: string, secret: string, createdAt: string }
    expect(body.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(body.url).toBe(`https://braid.test/webhooks/github/${workspace.id}/${SOURCE_ID}`)
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const stored = await secretStore.read<{ secret: string }>('webhook-github', `${workspace.id}--${SOURCE_ID}`)
    expect(stored?.secret).toBe(body.secret)
  })

  it('replaces the previous secret on subsequent rotations', async () => {
    const { app, workspace } = await buildApp({ withSecret: 'old-secret' })

    const response = await app.request(`/workspaces/${workspace.id}/source-webhooks/${SOURCE_ID}/github/rotate`, {
      method: 'POST',
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { secret: string }
    expect(body.secret).not.toBe('old-secret')
  })
})
