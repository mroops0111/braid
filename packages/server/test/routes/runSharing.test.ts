import type { WorkspaceId } from '@braidhq/schema'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { asUser, asUserJson, buildMultiUserApp } from '../helpers/multiUser.js'
import { seedEvents, seedRuns } from '../helpers/runs.js'

const SESSION = 'sess-maintainer'

/**
 * One conversation started by the maintainer, over two runs.
 *
 * Two runs because a share names the session,
 * and a resumed conversation would otherwise prove nothing,
 * about whether both halves of it travel together.
 */
async function seedConversation(workspaceRootPath: string, workspaceId: WorkspaceId, startedBy: string): Promise<void> {
  await seedRuns(workspaceRootPath, workspaceId, [
    { runId: 'run-first', startedBy, sessionId: SESSION, startedAt: '2026-05-21T10:00:00.000Z' },
    { runId: 'run-second', startedBy, sessionId: SESSION, startedAt: '2026-05-21T11:00:00.000Z' },
  ])
  await seedEvents(workspaceRootPath, 'run-first', 'the first answer')
  await seedEvents(workspaceRootPath, 'run-second', 'the second answer')
}

async function listRunIds(app: OpenAPIHono, workspaceId: WorkspaceId, userId: string): Promise<string[]> {
  const response = await app.request(`/workspaces/${workspaceId}/runs`, asUser(userId as never))
  expect(response.status).toBe(200)
  const body = await response.json() as { items: ReadonlyArray<{ runId: string }> }
  return body.items.map(item => item.runId).sort()
}

async function share(app: OpenAPIHono, workspaceId: WorkspaceId, actor: string, grantee: string): Promise<Response> {
  return app.request(
    `/workspaces/${workspaceId}/runs/sessions/${SESSION}/shares`,
    asUserJson(actor as never, 'POST', { userId: grantee }),
  )
}

async function unshare(app: OpenAPIHono, workspaceId: WorkspaceId, actor: string, grantee: string): Promise<Response> {
  return app.request(
    `/workspaces/${workspaceId}/runs/sessions/${SESSION}/shares/${grantee}`,
    asUserJson(actor as never, 'DELETE'),
  )
}

describe('sharing a conversation', () => {
  it('lets the recipient list and read every run under the shared session', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)

    expect(await listRunIds(app, workspaceId, users.guest.id)).toEqual([])

    const granted = await share(app, workspaceId, users.maintainer.id, users.guest.id)
    expect(granted.status).toBe(201)

    expect(await listRunIds(app, workspaceId, users.guest.id)).toEqual(['run-first', 'run-second'])

    const transcript = await app.request(
      `/workspaces/${workspaceId}/runs/run-second/events.json`,
      asUser(users.guest.id as never),
    )
    expect(transcript.status).toBe(200)
    const body = await transcript.json() as { items: ReadonlyArray<{ text?: string }> }
    expect(body.items[0]?.text).toBe('the second answer')
  })

  it('carries the session title into the recipient\'s conversations list', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)
    const titled = await app.request(
      `/workspaces/${workspaceId}/runs/sessions/${SESSION}`,
      asUserJson(users.maintainer.id as never, 'PATCH', { title: 'the shared one' }),
    )
    expect(titled.status).toBe(200)

    await share(app, workspaceId, users.maintainer.id, users.guest.id)

    const response = await app.request(`/workspaces/${workspaceId}/runs/sessions`, asUser(users.guest.id as never))
    expect(response.status).toBe(200)
    const body = await response.json() as { items: ReadonlyArray<{ sessionId: string, title: string | null }> }
    expect(body.items).toEqual([expect.objectContaining({ sessionId: SESSION, title: 'the shared one' })])
  })

  it('keeps the grant read-only, so the recipient cannot cancel, rename, or delete', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)
    await share(app, workspaceId, users.maintainer.id, users.guest.id)
    const guest = users.guest.id as never

    const cancelled = await app.request(`/workspaces/${workspaceId}/runs/run-second/cancel`, asUserJson(guest, 'POST'))
    expect(cancelled.status).toBe(404)

    const renamed = await app.request(
      `/workspaces/${workspaceId}/runs/sessions/${SESSION}`,
      asUserJson(guest, 'PATCH', { title: 'not yours to name' }),
    )
    expect(renamed.status).toBe(404)

    const deletedRun = await app.request(`/workspaces/${workspaceId}/runs/run-first`, asUserJson(guest, 'DELETE'))
    expect(deletedRun.status).toBe(404)

    const deleted = await app.request(
      `/workspaces/${workspaceId}/runs/sessions/${SESSION}`,
      asUserJson(guest, 'DELETE'),
    )
    expect(deleted.status).toBe(404)

    // Nothing the recipient asked for touched the conversation.
    expect(await listRunIds(app, workspaceId, users.maintainer.id)).toEqual(['run-first', 'run-second'])
  })

  it('does not let the recipient carry the conversation on', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)
    await share(app, workspaceId, users.maintainer.id, users.guest.id)

    // The recipient reads the session id off the transcript they were lent,
    // so resuming is the one write they could reach without an id of their own.
    const resumed = await app.request(
      `/workspaces/${workspaceId}/skills/braid:ask/run`,
      asUserJson(users.guest.id as never, 'POST', { args: 'and then?', resumeSessionId: SESSION }),
    )
    expect(resumed.status).toBe(404)
  })

  it('cannot be passed on, since the recipient did not start the conversation', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)
    await share(app, workspaceId, users.maintainer.id, users.guest.id)

    const passedOn = await share(app, workspaceId, users.guest.id, users.owner.id)
    expect(passedOn.status).toBe(403)
  })

  it('refuses an owner sharing a conversation they did not start', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)

    const response = await share(app, workspaceId, users.owner.id, users.guest.id)
    expect(response.status).toBe(403)
    expect(await listRunIds(app, workspaceId, users.guest.id)).toEqual([])
  })

  it('answers the same 403 for a session that does not exist, so a probe learns nothing', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)

    const response = await app.request(
      `/workspaces/${workspaceId}/runs/sessions/sess-nothing-here/shares`,
      asUserJson(users.owner.id as never, 'POST', { userId: users.guest.id }),
    )
    expect(response.status).toBe(403)
  })

  it('refuses a grantee who is not a member of the workspace', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)

    const response = await share(app, workspaceId, users.maintainer.id, users.outsider.id)
    expect(response.status).toBe(404)
  })

  it('refuses a grant to the person who started it', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)

    const response = await share(app, workspaceId, users.maintainer.id, users.maintainer.id)
    expect(response.status).toBe(400)
  })
})

describe('withdrawing a share', () => {
  it('takes the conversation back out of the recipient\'s list and transcript', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)
    await share(app, workspaceId, users.maintainer.id, users.guest.id)
    expect(await listRunIds(app, workspaceId, users.guest.id)).toEqual(['run-first', 'run-second'])

    const withdrawn = await unshare(app, workspaceId, users.maintainer.id, users.guest.id)
    expect(withdrawn.status).toBe(204)

    expect(await listRunIds(app, workspaceId, users.guest.id)).toEqual([])
    const transcript = await app.request(
      `/workspaces/${workspaceId}/runs/run-second/events.json`,
      asUser(users.guest.id as never),
    )
    // Absent, the same answer an unshared run has always given.
    expect(transcript.status).toBe(404)
  })

  it('takes the grant with it when the author deletes the conversation', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)
    await share(app, workspaceId, users.maintainer.id, users.guest.id)

    const deleted = await app.request(
      `/workspaces/${workspaceId}/runs/sessions/${SESSION}`,
      asUserJson(users.maintainer.id as never, 'DELETE'),
    )
    expect(deleted.status).toBe(204)

    // The ledger stops naming a conversation nothing is left to read.
    const response = await app.request(`/workspaces/${workspaceId}/runs/shares`, asUser(users.maintainer.id as never))
    const body = await response.json() as { items: readonly unknown[] }
    expect(body.items).toEqual([])
  })

  it('erases the grant rather than withdrawing it, so a delete leaves no trace', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)
    await share(app, workspaceId, users.maintainer.id, users.guest.id)

    await app.request(
      `/workspaces/${workspaceId}/runs/sessions/${SESSION}`,
      asUserJson(users.maintainer.id as never, 'DELETE'),
    )

    // A withdrawn copy would still name the session it pointed at.
    const ledger = join(workspaceRootPath, 'artifacts', 'runs', 'shares.jsonl')
    const raw = await readFile(ledger, 'utf-8').catch(() => '')
    expect(raw).not.toContain(SESSION)
  })

  it('answers 404 when there is no live grant to withdraw', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)

    const response = await unshare(app, workspaceId, users.maintainer.id, users.guest.id)
    expect(response.status).toBe(404)
  })

  it('can be granted again after being withdrawn', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)
    await share(app, workspaceId, users.maintainer.id, users.guest.id)
    await unshare(app, workspaceId, users.maintainer.id, users.guest.id)

    const again = await share(app, workspaceId, users.maintainer.id, users.guest.id)
    expect(again.status).toBe(201)
    expect(await listRunIds(app, workspaceId, users.guest.id)).toEqual(['run-first', 'run-second'])
  })
})

describe('listing shares', () => {
  it('shows both sides of a grant and hides one between two other people', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)
    await share(app, workspaceId, users.maintainer.id, users.guest.id)

    for (const userId of [users.maintainer.id, users.guest.id]) {
      const response = await app.request(`/workspaces/${workspaceId}/runs/shares`, asUser(userId as never))
      expect(response.status).toBe(200)
      const body = await response.json() as { items: ReadonlyArray<{ sessionId: string, grantee: string }> }
      expect(body.items).toEqual([
        expect.objectContaining({ sessionId: SESSION, grantee: users.guest.id }),
      ])
    }

    const bystander = await app.request(`/workspaces/${workspaceId}/runs/shares`, asUser(users.owner.id as never))
    const body = await bystander.json() as { items: readonly unknown[] }
    expect(body.items).toEqual([])
  })

  it('drops a withdrawn grant from both sides', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    await seedConversation(workspaceRootPath, workspaceId, users.maintainer.id)
    await share(app, workspaceId, users.maintainer.id, users.guest.id)
    await unshare(app, workspaceId, users.maintainer.id, users.guest.id)

    const response = await app.request(`/workspaces/${workspaceId}/runs/shares`, asUser(users.maintainer.id as never))
    const body = await response.json() as { items: readonly unknown[] }
    expect(body.items).toEqual([])
  })
})
