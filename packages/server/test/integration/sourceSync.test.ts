import type { SourceSyncState } from '@braidhq/schema'
import type { OpenAPIHono } from '@hono/zod-openapi'
import type { AppDependencies } from '../../src/composeApp.js'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeFsApp } from '../../src/composeFsApp.js'
import { readJson } from '../helpers/readJson.js'

/**
 * Exercises the assembled sync path against a real git remote, a real server,
 * and real files. The remote is a local bare repo rather than a hosted one,
 * so the run stays offline and deterministic.
 *
 * The pieces have their own unit tests.
 * What only shows up here is the wiring, whether a scaffold provisions,
 * whether the health record lands where the repository says it does,
 * and whether a broken remote degrades rather than throws.
 */
describe('source sync', () => {
  let braidHome: string
  let scratch: string
  let remoteUrl: string
  let upstream: ReturnType<typeof simpleGit>
  let deps: AppDependencies
  let app: OpenAPIHono

  async function scaffold(loaderConfig: Record<string, unknown>, sync?: { maxStalenessMs: number }): Promise<string> {
    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'sync-ws',
        manifest: {
          name: 'sync-ws',
          sources: [
            { kind: 'filesystem', id: 'intent', role: 'intent', name: 'intent', path: './intent' },
            {
              kind: 'filesystem',
              id: 'app',
              role: 'code',
              name: 'app',
              path: './codebases/app',
              loader: { kind: 'git', config: loaderConfig },
              ...(sync ? { sync } : {}),
            },
          ],
        },
      }),
    })
    return (await readJson<{ workspace: { id: string } }>(response)).workspace.id
  }

  async function syncState(workspaceId: string): Promise<SourceSyncState | undefined> {
    const response = await app.request(`/workspaces/${workspaceId}/source-sync-states`)
    const body = await readJson<{ states: SourceSyncState[] }>(response)
    return body.states.find(state => state.sourceId === 'app')
  }

  function mirroredFile(workspaceId: string): string {
    return join(braidHome, 'workspaces', workspaceId, 'codebases', 'app', 'README.md')
  }

  beforeEach(async () => {
    braidHome = await mkdtemp(join(tmpdir(), 'braid-source-sync-home-'))
    scratch = await mkdtemp(join(tmpdir(), 'braid-source-sync-remote-'))

    const seedDir = join(scratch, 'seed')
    await mkdir(seedDir, { recursive: true })
    const seed = simpleGit({ baseDir: seedDir })
    await seed.init(['--initial-branch=master'])
    await seed.addConfig('user.name', 'tester')
    await seed.addConfig('user.email', 't@example.com')
    await writeFile(join(seedDir, 'README.md'), '# v1\n', 'utf-8')
    await seed.add('.').commit('v1', ['--no-gpg-sign'])
    const remoteDir = join(scratch, 'remote')
    await simpleGit().clone(seedDir, remoteDir, ['--bare'])
    remoteUrl = `file://${remoteDir}`

    const upstreamDir = join(scratch, 'upstream')
    await simpleGit().clone(remoteUrl, upstreamDir)
    upstream = simpleGit({ baseDir: upstreamDir })
    await upstream.addConfig('user.name', 'tester')
    await upstream.addConfig('user.email', 't@example.com')

    deps = await composeFsApp({ braidHome })
    app = createApp(deps)
  })

  afterEach(async () => {
    // Boot fires its catch-up syncs fire-and-forget,
    // so one can still be in flight here.
    // Removing the home under it logs a resolve failure,
    // which is teardown noise rather than a defect worth chasing.
    deps.sourcePollingService.stopAll()
    await rm(braidHome, { recursive: true, force: true }).catch(() => {})
    await rm(scratch, { recursive: true, force: true }).catch(() => {})
  })

  async function pushUpstream(contents: string): Promise<void> {
    await writeFile(join(scratch, 'upstream', 'README.md'), contents, 'utf-8')
    await upstream.add('.').commit('next', ['--no-gpg-sign'])
    await upstream.push('origin', 'HEAD')
  }

  it('mirrors the remote at scaffold and records what it landed on', async () => {
    const workspaceId = await scaffold({ url: remoteUrl, branch: 'master' })

    expect(await readFile(mirroredFile(workspaceId), 'utf-8')).toBe('# v1\n')
    const state = await syncState(workspaceId)
    expect(state?.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(state?.consecutiveFailures).toBe(0)
    expect(state?.lastSuccessAt).toBeDefined()
  })

  it('advances the mirror and the recorded revision on a manual sync', async () => {
    const workspaceId = await scaffold({ url: remoteUrl, branch: 'master' })
    const before = (await syncState(workspaceId))?.revision
    await pushUpstream('# v2\n')

    const response = await app.request(`/workspaces/${workspaceId}/sources/app/sync`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await readFile(mirroredFile(workspaceId), 'utf-8')).toBe('# v2\n')
    expect((await syncState(workspaceId))?.revision).not.toBe(before)
  })

  it('tracks the default branch when the source names none', async () => {
    const workspaceId = await scaffold({ url: remoteUrl })
    await pushUpstream('# v2\n')

    await app.request(`/workspaces/${workspaceId}/sources/app/sync`, { method: 'POST' })

    expect(await readFile(mirroredFile(workspaceId), 'utf-8')).toBe('# v2\n')
  })

  it('records a failure without losing the mirror already on disk', async () => {
    const workspaceId = await scaffold({ url: remoteUrl, branch: 'master' })
    await rm(join(scratch, 'remote'), { recursive: true, force: true })

    const response = await app.request(`/workspaces/${workspaceId}/sources/app/sync`, { method: 'POST' })

    expect(response.status).toBeGreaterThanOrEqual(400)
    const state = await syncState(workspaceId)
    expect(state?.consecutiveFailures).toBe(1)
    expect(state?.lastError).toBeTruthy()
    // The mirror is still readable, which is what lets a run proceed on it.
    expect(await readFile(mirroredFile(workspaceId), 'utf-8')).toBe('# v1\n')
  })

  it('counts consecutive failures across attempts', async () => {
    const workspaceId = await scaffold({ url: remoteUrl, branch: 'master' })
    await rm(join(scratch, 'remote'), { recursive: true, force: true })

    await app.request(`/workspaces/${workspaceId}/sources/app/sync`, { method: 'POST' })
    await app.request(`/workspaces/${workspaceId}/sources/app/sync`, { method: 'POST' })

    expect((await syncState(workspaceId))?.consecutiveFailures).toBe(2)
  })

  it('keeps the recorded state across a restart, rather than re-cloning blind', async () => {
    const workspaceId = await scaffold({ url: remoteUrl, branch: 'master' })
    const before = await syncState(workspaceId)

    deps.sourcePollingService.stopAll()
    deps = await composeFsApp({ braidHome })
    app = createApp(deps)

    const after = await syncState(workspaceId)
    expect(after?.revision).toBe(before?.revision)
    expect(after?.lastSuccessAt).toBe(before?.lastSuccessAt)
  })

  it('turns the refresh schedule on and off through the source PATCH', async () => {
    const workspaceId = await scaffold({ url: remoteUrl, branch: 'master' })

    const enabled = await app.request(`/workspaces/${workspaceId}/sources/app`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync: { maxStalenessMs: 300_000 } }),
    })
    expect(enabled.status).toBe(200)
    expect(await readSourceSync(app, workspaceId)).toEqual({ maxStalenessMs: 300_000 })

    const cleared = await app.request(`/workspaces/${workspaceId}/sources/app`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync: null }),
    })
    expect(cleared.status).toBe(200)
    expect(await readSourceSync(app, workspaceId)).toBeUndefined()
  })

  it('pauses and resumes background refresh for the whole workspace', async () => {
    const workspaceId = await scaffold({ url: remoteUrl, branch: 'master' })

    const paused = await app.request(`/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polling: { enabled: false } }),
    })
    expect(paused.status).toBe(200)
    expect(await readPolling(app, workspaceId)).toEqual({ enabled: false })

    const resumed = await app.request(`/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polling: { enabled: true } }),
    })
    expect(resumed.status).toBe(200)
    expect(await readPolling(app, workspaceId)).toEqual({ enabled: true })
  })

  it('leaves each source schedule intact while background refresh is paused', async () => {
    const workspaceId = await scaffold({ url: remoteUrl, branch: 'master' }, { maxStalenessMs: 300_000 })

    await app.request(`/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ polling: { enabled: false } }),
    })

    expect(await readSourceSync(app, workspaceId)).toEqual({ maxStalenessMs: 300_000 })
  })

  it('refuses a refresh schedule on a source with nothing to pull', async () => {
    const workspaceId = await scaffold({ url: remoteUrl, branch: 'master' })

    const response = await app.request(`/workspaces/${workspaceId}/sources/intent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync: { maxStalenessMs: 300_000 } }),
    })

    expect(response.status).toBe(400)
  })
})

async function readPolling(app: OpenAPIHono, workspaceId: string): Promise<{ enabled: boolean } | undefined> {
  const response = await app.request(`/workspaces/${workspaceId}`)
  const workspace = await readJson<{ productManifest: { polling?: { enabled: boolean } } }>(response)
  return workspace.productManifest.polling
}

async function readSourceSync(app: OpenAPIHono, workspaceId: string): Promise<{ maxStalenessMs: number } | undefined> {
  const response = await app.request(`/workspaces/${workspaceId}`)
  const workspace = await readJson<{ productManifest: { sources: { id: string, sync?: { maxStalenessMs: number } }[] } }>(response)
  return workspace.productManifest.sources.find(source => source.id === 'app')?.sync
}
