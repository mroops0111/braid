import type { User, WorkspaceId } from '@braidhq/schema'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REACTOR_USER_ID } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { asUser, asUserJson, buildMultiUserApp } from '../helpers/multiUser.js'

const COMMAND = 'command'

interface IdList {
  items: ReadonlyArray<{ id: string }>
}

async function submitProposal(
  app: OpenAPIHono,
  workspaceId: WorkspaceId,
  submitter: User,
  nodeId: string,
): Promise<string> {
  const response = await app.request(
    `/workspaces/${workspaceId}/proposals`,
    asUserJson(submitter.id, 'POST', {
      operations: [{
        operation: 'addNode',
        payload: {
          type: COMMAND,
          name: nodeId,
          id: nodeId,
          metadata: { sourceReferences: [], missingRoles: ['code'] },
        },
      }],
      generatedBy: 'extract',
      rationale: `submitted by ${submitter.displayName}`,
    }),
  )
  expect(response.status).toBe(201)
  return (await response.json() as { id: string }).id
}

describe('handoff.read gates the queue', () => {
  it('refuses a guest the proposal and clarification lists', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    expect((await app.request(`/workspaces/${workspaceId}/proposals`, asUser(users.guest.id))).status).toBe(403)
    expect((await app.request(`/workspaces/${workspaceId}/clarifications`, asUser(users.guest.id))).status).toBe(403)
  })

  it('lets a maintainer read the queue', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    expect((await app.request(`/workspaces/${workspaceId}/proposals`, asUser(users.maintainer.id))).status).toBe(200)
  })
})

describe('one member\'s unsettled work stays theirs', () => {
  it('reports another member\'s pending proposal as absent, rather than forbidden', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()
    const ownersProposal = await submitProposal(app, workspaceId, users.owner, 'owner-node')

    const asMaintainer = await app.request(
      `/workspaces/${workspaceId}/proposals/${ownersProposal}`,
      asUser(users.maintainer.id),
    )
    expect(asMaintainer.status).toBe(404)
  })

  it('keeps it out of the maintainer\'s list too', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()
    await submitProposal(app, workspaceId, users.owner, 'owner-node')
    const mine = await submitProposal(app, workspaceId, users.maintainer, 'maintainer-node')

    const response = await app.request(`/workspaces/${workspaceId}/proposals`, asUser(users.maintainer.id))
    const body = await response.json() as IdList
    expect(body.items.map(item => item.id)).toEqual([mine])
  })

  it('shows a maintainer what the reactor handed over, which is nobody\'s in particular', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()
    await submitProposal(app, workspaceId, users.owner, 'owner-node')
    const autonomous = await submitProposal(
      app,
      workspaceId,
      { ...users.owner, id: REACTOR_USER_ID, displayName: 'Reactor' },
      'reactor-node',
    )

    const response = await app.request(`/workspaces/${workspaceId}/proposals`, asUser(users.maintainer.id))
    const body = await response.json() as IdList
    expect(body.items.map(item => item.id)).toEqual([autonomous])
  })

  it('lets whoever governs the workspace read it by id', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()
    const maintainersProposal = await submitProposal(app, workspaceId, users.maintainer, 'maintainer-node')

    const asOwner = await app.request(
      `/workspaces/${workspaceId}/proposals/${maintainersProposal}`,
      asUser(users.owner.id),
    )
    expect(asOwner.status).toBe(200)
  })
})

describe('the coverage board never counts a queue its reader may not open', () => {
  it('strips handoff ids for a guest, and keeps them for a maintainer', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const forGuest = await app.request(`/workspaces/${workspaceId}/coverage`, asUser(users.guest.id))
    expect(forGuest.status).toBe(200)
    const guestBoard = await forGuest.json() as {
      cards: ReadonlyArray<{ proposalIds: string[], clarificationIds: string[] }>
      stages: ReadonlyArray<{ proposalIds: string[], clarificationIds: string[], answeredIds: string[] }>
    }
    for (const card of guestBoard.cards) {
      expect(card.proposalIds).toEqual([])
      expect(card.clarificationIds).toEqual([])
    }
    for (const stage of guestBoard.stages) {
      expect(stage.proposalIds).toEqual([])
      expect(stage.clarificationIds).toEqual([])
      expect(stage.answeredIds).toEqual([])
    }

    expect((await app.request(`/workspaces/${workspaceId}/coverage`, asUser(users.maintainer.id))).status).toBe(200)
  })
})

describe('a batch is the per-unit skill run many times over', () => {
  it('refuses a guest, who may run no skill here', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/batch`,
      asUserJson(users.guest.id, 'POST', { autoApply: false }),
    )
    expect(response.status).toBe(403)
    expect((await app.request(
      `/workspaces/${workspaceId}/batch/stop`,
      asUserJson(users.guest.id, 'POST'),
    )).status).toBe(403)
  })
})

describe('writing a document is the generator skill run', () => {
  it('lets every role read what was written', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    for (const user of [users.owner, users.maintainer, users.guest])
      expect((await app.request(`/workspaces/${workspaceId}/views`, asUser(user.id))).status).toBe(200)
  })

  it('refuses a guest the write, who may run no generator here', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    const response = await app.request(
      `/workspaces/${workspaceId}/views`,
      asUserJson(users.guest.id, 'POST', { kind: 'doc', form: 'reference', subject: 'ctx.any' }),
    )
    expect(response.status).toBe(403)
  })

  it('lets a maintainer past the gate, so the subject is what answers next', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()

    // The node does not exist, so a 404 about the subject is the point:
    // it is the handler answering rather than the gate.
    const response = await app.request(
      `/workspaces/${workspaceId}/views`,
      asUserJson(users.maintainer.id, 'POST', { kind: 'doc', form: 'reference', subject: 'ctx.any' }),
    )
    expect(response.status).toBe(404)
  })
})

describe('replaying a run answers as fully as reading it', () => {
  it('refuses a maintainer another member\'s transcript', async () => {
    const { app, workspaceId, workspaceRootPath, users } = await buildMultiUserApp()
    const dir = join(workspaceRootPath, 'artifacts', 'runs')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'index.jsonl'), `${JSON.stringify({
      runId: 'run-owner',
      workspaceId,
      skillId: 'braid:ask',
      args: 'a question',
      resumed: false,
      startedAt: '2026-05-21T10:00:00.000Z',
      startedBy: users.owner.id,
    })}\n`, 'utf-8')

    const response = await app.request(
      `/workspaces/${workspaceId}/agui/runs/run-owner`,
      asUser(users.maintainer.id),
    )
    expect(response.status).toBe(404)
  })
})
