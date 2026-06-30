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
      body: JSON.stringify({
        name: 'rt',
        manifest: {
          name: 'rt',
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
    expect(items[0]!.message.kind).toBe('proposal-apply')
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

  it('GET /history/graph-diff classifies node-level adds/removes between two commits', async () => {
    await applyOne('placeOrder', 'cmd-a')
    const v1List = await readJson<{ items: CommitItem[] }>(await app.request(`/workspaces/${workspaceId}/history`))
    const v1 = v1List.items[0]!.sha
    await applyOne('ackOrder', 'cmd-b')
    const v2List = await readJson<{ items: CommitItem[] }>(await app.request(`/workspaces/${workspaceId}/history`))
    const v2 = v2List.items[0]!.sha

    const diffResponse = await app.request(
      `/workspaces/${workspaceId}/history/graph-diff?from=${v1}&to=${v2}`,
    )
    expect(diffResponse.status).toBe(200)
    const envelope = await readJson<{
      from: string
      to: string
      snapshot: { nodes: Array<{ id: string }> }
      removed: { nodes: Array<{ id: string, name: string }>, edges: Array<{ id: string }> }
      changes: { nodes: Record<string, string>, edges: Record<string, string> }
    }>(diffResponse)

    expect(envelope.from).toBe(v1)
    expect(envelope.to).toBe(v2)
    expect(envelope.snapshot.nodes.some(n => n.id === 'cmd-b')).toBe(true)
    expect(envelope.changes.nodes['cmd-b']).toBe('added')
    expect(envelope.changes.nodes['cmd-a']).toBeUndefined()
    expect(envelope.removed.nodes).toEqual([])
    expect(envelope.removed.edges).toEqual([])
  })

  it('GET /history/graph-diff surfaces removed entities with their from-state details', async () => {
    await applyOne('placeOrder', 'cmd-rm')
    const beforeRemove = await readJson<{ items: CommitItem[] }>(await app.request(`/workspaces/${workspaceId}/history`))
    const v1 = beforeRemove.items[0]!.sha

    // Submit + apply a remove proposal to take cmd-rm out of the graph.
    const removeSubmit = await app.request(`/workspaces/${workspaceId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ operation: 'removeNode', nodeId: 'cmd-rm' }],
        rationale: 'drop cmd-rm',
        generatedBy: 'extract',
      }),
    })
    const { id: removeId } = await readJson<{ id: string }>(removeSubmit)
    await app.request(`/workspaces/${workspaceId}/proposals/${removeId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'tester' }),
    })
    const afterRemove = await readJson<{ items: CommitItem[] }>(await app.request(`/workspaces/${workspaceId}/history`))
    const v2 = afterRemove.items[0]!.sha

    const envelope = await readJson<{
      removed: { nodes: Array<{ id: string, name: string }> }
      changes: { nodes: Record<string, string> }
    }>(await app.request(`/workspaces/${workspaceId}/history/graph-diff?from=${v1}&to=${v2}`))

    expect(envelope.changes.nodes['cmd-rm']).toBe('removed')
    expect(envelope.removed.nodes.map(n => n.id)).toEqual(['cmd-rm'])
    expect(envelope.removed.nodes[0]!.name).toBe('placeOrder')
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
