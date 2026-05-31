import type { OpenAPIHono } from '@hono/zod-openapi'
import type { AppDependencies } from '../../src/composition.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { composeFsApp } from '../../src/composeFs.js'
import { readJson } from '../helpers/readJson.js'

interface CommitItem { sha: string, message: { kind: string, subject: string, proposalId?: string } }

describe('history REST routes', () => {
  let braidHome: string
  let deps: AppDependencies
  let app: OpenAPIHono
  let workspaceId: string

  beforeEach(async () => {
    braidHome = await mkdtemp(join(tmpdir(), 'braid-history-routes-'))
    deps = await composeFsApp({ braidHome })
    app = createApp(deps)
    const response = await app.request('/workspaces/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'rt', manifest: { name: 'rt', sources: [] } }),
    })
    workspaceId = (await readJson<{ workspace: { id: string } }>(response)).workspace.id
  })

  afterEach(async () => {
    await rm(braidHome, { recursive: true, force: true }).catch(() => {})
  })

  async function applyOne(name: string, id: string): Promise<string> {
    const submit = await app.request(`/workspaces/${workspaceId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          operation: 'addNode',
          payload: { type: 'command', name, id, metadata: { sourceReferences: [], implementationMissing: true } },
        }],
        rationale: name,
        generatedBy: 'extract',
      }),
    })
    const { id: proposalId } = await readJson<{ id: string }>(submit)
    await app.request(`/workspaces/${workspaceId}/proposals/${proposalId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'tester' }),
    })
    return proposalId
  }

  it('GET /history lists commits newest-first', async () => {
    await applyOne('placeOrder', 'cmd-a')
    await applyOne('ackOrder', 'cmd-b')

    const response = await app.request(`/workspaces/${workspaceId}/history`)
    const { items } = await readJson<{ items: CommitItem[] }>(response)
    expect(items.length).toBeGreaterThanOrEqual(3) // initial + 2 applies
    expect(items[0]!.message.kind).toBe('apply')
  })

  it('GET /history/:sha returns commit detail plus diff', async () => {
    await applyOne('placeOrder', 'cmd-a')
    const list = await readJson<{ items: CommitItem[] }>(await app.request(`/workspaces/${workspaceId}/history`))
    const head = list.items[0]!

    const detail = await app.request(`/workspaces/${workspaceId}/history/${head.sha}`)
    const body = await readJson<{ sha: string, diff: Array<{ path: string, status: string }> }>(detail)
    expect(body.sha).toBe(head.sha)
    expect(body.diff.some(d => d.path === 'artifacts/graph.json')).toBe(true)
  })

  it('POST /history/:sha/restore rolls back graph and produces a forward commit', async () => {
    await applyOne('placeOrder', 'cmd-a')
    const beforeList = await readJson<{ items: CommitItem[] }>(await app.request(`/workspaces/${workspaceId}/history`))
    const v1Sha = beforeList.items[beforeList.items.length - 1]!.sha // the initial commit
    await applyOne('ackOrder', 'cmd-b')
    // Sanity: cmd-b is now in the graph.
    const before = await readJson<{ items: Array<{ id: string }> }>(await app.request(`/workspaces/${workspaceId}/nodes`))
    expect(before.items.find(n => n.id === 'cmd-b')).toBeDefined()

    const restore = await app.request(`/workspaces/${workspaceId}/history/${v1Sha}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'tester' }),
    })
    expect(restore.status).toBe(200)

    // Backend should now reflect the v1 state (no cmd-b).
    const after = await readJson<{ items: Array<{ id: string }> }>(await app.request(`/workspaces/${workspaceId}/nodes`))
    expect(after.items.find(n => n.id === 'cmd-b')).toBeUndefined()
    // History gained a `restore` commit on top.
    const finalList = await readJson<{ items: CommitItem[] }>(await app.request(`/workspaces/${workspaceId}/history`))
    expect(finalList.items[0]!.message.kind).toBe('restore')
  })

  it('POST /history/tags creates an annotated tag, GET lists it, DELETE removes it', async () => {
    await applyOne('placeOrder', 'cmd-a')
    const list = await readJson<{ items: CommitItem[] }>(await app.request(`/workspaces/${workspaceId}/history`))
    const head = list.items[0]!

    const create = await app.request(`/workspaces/${workspaceId}/history/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: head.sha, name: 'milestone-1', note: 'first apply done' }),
    })
    expect(create.status).toBe(201)

    const listTags = await readJson<{ items: Array<{ name: string }> }>(
      await app.request(`/workspaces/${workspaceId}/history/tags`),
    )
    expect(listTags.items.some(t => t.name === 'milestone-1')).toBe(true)

    const del = await app.request(`/workspaces/${workspaceId}/history/tags/milestone-1`, {
      method: 'DELETE',
    })
    expect(del.status).toBe(204)
    const afterDelete = await readJson<{ items: Array<{ name: string }> }>(
      await app.request(`/workspaces/${workspaceId}/history/tags`),
    )
    expect(afterDelete.items.find(t => t.name === 'milestone-1')).toBeUndefined()
  })
})
