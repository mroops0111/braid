import type { SourceLoaderPlugin } from '@braidhq/core'
import type { AbsolutePath, LoaderKind, PluginId, SourceId, SourceRole, Timestamp } from '@braidhq/schema'
import type { SecretStore } from '../../src/infrastructure/secrets/SecretStore.js'
import { createHmac } from 'node:crypto'
import { PluginRegistry } from '@braidhq/core'
import { makeWorkspace } from '@braidhq/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composeApp.js'

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
    role: 'primary' as SourceRole,
    name: 'issues',
    path: '/abs/ws/issues' as AbsolutePath,
    loader: {
      kind: 'github' as LoaderKind,
      config: { owner: OWNER, repo: REPO },
    },
  }
}

function makeGitSource(branch?: string) {
  return {
    kind: 'filesystem' as const,
    id: SOURCE_ID,
    role: 'secondary' as SourceRole,
    name: 'code',
    path: '/abs/ws/code' as AbsolutePath,
    loader: {
      kind: 'git' as LoaderKind,
      config: {
        url: `https://github.com/${OWNER}/${REPO}.git`,
        ...(branch ? { branch } : {}),
      },
    },
  }
}

// Stand-in loader plugins for the receiver's plugin-registry lookup.
// We deliberately bypass `defineSourceLoaderPlugin` and construct the plugin
// object literal so the test stays loader-agnostic: it only exercises
// the receiver's contract (delegate to `plugin.webhook.{upstream,
// shouldDispatch}`) and does NOT reproduce production loader semantics.
// Each real loader has its own webhook unit test in its own package.
const FAKE_FETCHED_AT = '2026-01-01T00:00:00.000Z' as Timestamp

interface FakeLoaderOptions {
  readonly kind: string
  readonly upstream: SourceLoaderPlugin['webhook'] extends infer T
    ? T extends { upstream: infer R } ? R : never
    : never
  readonly shouldDispatch?: NonNullable<SourceLoaderPlugin['webhook']>['shouldDispatch']
}

function makeFakeLoader(opts: FakeLoaderOptions): SourceLoaderPlugin {
  return {
    id: `fake.${opts.kind}` as PluginId,
    type: 'source-loader',
    kind: opts.kind as LoaderKind,
    configSchema: z.unknown(),
    provision: async () => ({ localPath: '/abs/x' as AbsolutePath, fetchedAt: FAKE_FETCHED_AT }),
    webhook: {
      upstream: opts.upstream,
      ...(opts.shouldDispatch ? { shouldDispatch: opts.shouldDispatch } : {}),
    },
  }
}

const githubLikeFake = makeFakeLoader({
  kind: 'github',
  upstream: (config) => {
    const c = config as { owner?: unknown, repo?: unknown }
    if (typeof c.owner !== 'string' || typeof c.repo !== 'string')
      return undefined
    return { host: 'github.com', path: `${c.owner}/${c.repo}` }
  },
  shouldDispatch: (_c, d) => d.event === 'issues' || d.event === 'issue_comment' || d.event === 'ping',
})

const gitLikeFake = makeFakeLoader({
  kind: 'git',
  upstream: (config) => {
    const url = (config as { url?: unknown }).url
    if (typeof url !== 'string')
      return undefined
    const match = url.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/)
    return match ? { host: match[1]!.toLowerCase(), path: match[2]! } : undefined
  },
  shouldDispatch: (config, delivery) => {
    if (delivery.event === 'ping')
      return true
    if (delivery.event !== 'push')
      return false
    const ref = typeof delivery.payload === 'object' && delivery.payload !== null
      ? (delivery.payload as { ref?: unknown }).ref
      : undefined
    if (typeof ref !== 'string')
      return false
    const branch = (config as { branch?: unknown }).branch
    if (typeof branch === 'string')
      return ref === `refs/heads/${branch}`
    return ref === 'refs/heads/main' || ref === 'refs/heads/master'
  },
})

async function buildApp(opts: { withSecret?: string, source?: ReturnType<typeof makeGithubSource> | ReturnType<typeof makeGitSource> } = {}) {
  const workspace = makeWorkspace({ sources: [opts.source ?? makeGithubSource()] })
  const secretStore = makeInMemorySecretStore()
  const pluginRegistry = new PluginRegistry()
  pluginRegistry.register(githubLikeFake)
  pluginRegistry.register(gitLikeFake)
  const deps = composeApp({ pluginRegistry })
  deps.secretStore = secretStore
  await deps.workspaceRepository.save(workspace)

  // Replace the sync service with a spy. The real one would invoke the github
  // plugin for real, and these tests only assert that the receiver dispatched.
  const syncOne = vi.fn().mockResolvedValue({
    sourceId: SOURCE_ID,
    new: [],
    changed: [],
    unchanged: [],
    orphaned: [],
  })
  deps.sourceSyncService = { syncNow: syncOne } as never

  if (opts.withSecret) {
    await secretStore.write('webhook-github', composeSecretKey(workspace.id, SOURCE_ID), {
      secret: opts.withSecret,
      createdAt: '2026-06-19T00:00:00.000Z',
    })
  }

  const app = createApp(deps, { apiUrl: 'https://braid.test' })
  return { app, workspace, secretStore, syncOne }
}

// Mirror the receiver's composite key so secrets the test pre-writes
// land in the same slot the receiver will read.
function composeSecretKey(workspaceId: string, sourceId: string): string {
  return `${workspaceId}--${sourceId}`
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

  it('returns 401 (uniform anonymous response) when the X-Hub-Signature-256 header is missing', async () => {
    const { app, workspace, syncOne } = await buildApp({ withSecret: 'super-secret' })
    const body = JSON.stringify({ repository: { full_name: `${OWNER}/${REPO}` } })
    const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'issues' },
      body,
    })
    expect(response.status).toBe(401)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(syncOne).not.toHaveBeenCalled()
  })

  it('returns 400 when X-GitHub-Event is missing on a verified delivery (no silent skip)', async () => {
    const { app, workspace, syncOne } = await buildApp({ withSecret: 'super-secret' })
    const body = JSON.stringify({ repository: { full_name: `${OWNER}/${REPO}` } })
    const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': sign('super-secret', body),
      },
      body,
    })
    expect(response.status).toBe(400)
    const json = await response.json() as { detail?: string }
    expect(json.detail).toContain('X-GitHub-Event')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(syncOne).not.toHaveBeenCalled()
  })

  it('returns 400 when the verified payload omits repository.full_name (no silent dispatch)', async () => {
    const { app, workspace, syncOne } = await buildApp({ withSecret: 'super-secret' })
    const body = JSON.stringify({ action: 'opened' })
    const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues',
        'X-Hub-Signature-256': sign('super-secret', body),
      },
      body,
    })
    expect(response.status).toBe(400)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(syncOne).not.toHaveBeenCalled()
  })

  it('accepts a delivery whose full_name differs in case from the configured owner/repo (github is case-insensitive)', async () => {
    const { app, workspace, syncOne } = await buildApp({ withSecret: 'super-secret' })
    const body = JSON.stringify({ repository: { full_name: `${OWNER.toUpperCase()}/${REPO.toUpperCase()}` } })
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
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(syncOne).toHaveBeenCalledTimes(1)
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

  it('accepts a push to the tracked branch on a git-loader source and dispatches syncOne', async () => {
    const { app, workspace, syncOne } = await buildApp({
      withSecret: 'super-secret',
      source: makeGitSource('master'),
    })
    const body = JSON.stringify({ ref: 'refs/heads/master', repository: { full_name: `${OWNER}/${REPO}` } })

    const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'push',
        'X-Hub-Signature-256': sign('super-secret', body),
      },
      body,
    })

    expect(response.status).toBe(202)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(syncOne).toHaveBeenCalledTimes(1)
  })

  it('accepts but skips syncOne when a push targets a branch other than the one the git loader tracks', async () => {
    const { app, workspace, syncOne } = await buildApp({
      withSecret: 'super-secret',
      source: makeGitSource('master'),
    })
    const body = JSON.stringify({ ref: 'refs/heads/feature-x', repository: { full_name: `${OWNER}/${REPO}` } })

    const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'push',
        'X-Hub-Signature-256': sign('super-secret', body),
      },
      body,
    })

    expect(response.status).toBe(202)
    const json = await response.json() as { skipped?: boolean }
    expect(json.skipped).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(syncOne).not.toHaveBeenCalled()
  })

  it('dispatches on every ref the loader plugin accepts, without reading the config itself', async () => {
    const { app, workspace, syncOne } = await buildApp({
      withSecret: 'super-secret',
      source: makeGitSource(),
    })
    for (const ref of ['refs/heads/main', 'refs/heads/master']) {
      const body = JSON.stringify({ ref, repository: { full_name: `${OWNER}/${REPO}` } })
      const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-Hub-Signature-256': sign('super-secret', body),
        },
        body,
      })
      expect(response.status).toBe(202)
      const json = await response.json() as { skipped?: boolean }
      expect(json.skipped).toBe(false)
      // Reset the in-flight tracker by letting the mocked resolve happen
      await new Promise(r => setTimeout(r, 20))
    }
    expect(syncOne.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('accepts but skips a push event delivered to a github-issues loader source', async () => {
    const { app, workspace, syncOne } = await buildApp({ withSecret: 'super-secret' })
    const body = JSON.stringify({ ref: 'refs/heads/master', repository: { full_name: `${OWNER}/${REPO}` } })

    const response = await app.request(`/webhooks/github/${workspace.id}/${SOURCE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'push',
        'X-Hub-Signature-256': sign('super-secret', body),
      },
      body,
    })

    expect(response.status).toBe(202)
    const json = await response.json() as { skipped?: boolean }
    expect(json.skipped).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(syncOne).not.toHaveBeenCalled()
  })

  it('returns uniform 401 (no oracle) when no webhook secret has been provisioned for the source', async () => {
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

    expect(response.status).toBe(401)
    const json = await response.json() as { detail?: string }
    // Anonymous callers learn nothing about which (ws, source) pairs
    // exist or are webhook-armed.
    expect(json.detail).toBe('Invalid webhook signature.')
  })

  it('returns uniform 401 for an unknown workspace + source so attackers cannot enumerate ids', async () => {
    const { app } = await buildApp({ withSecret: 'super-secret' })
    const body = JSON.stringify({ repository: { full_name: `${OWNER}/${REPO}` } })
    const response = await app.request(`/webhooks/github/no-such-ws/no-such-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'issues',
        'X-Hub-Signature-256': sign('super-secret', body),
      },
      body,
    })
    expect(response.status).toBe(401)
    const json = await response.json() as { detail?: string }
    expect(json.detail).toBe('Invalid webhook signature.')
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

    const stored = await secretStore.read<{ secret: string }>('webhook-github', composeSecretKey(workspace.id, SOURCE_ID))
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
