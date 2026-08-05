import type { User, WorkspaceId } from '@braidhq/schema'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { describe, expect, it } from 'vitest'
import { asUserJson, buildMultiUserApp } from '../helpers/multiUser.js'
import { readJson } from '../helpers/readJson.js'

const COMMAND = 'command'

interface PendingItemList {
  items: ReadonlyArray<{ id: string, owner?: string }>
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
  const body = await response.json() as { id: string }
  return body.id
}

async function submitClarification(
  app: OpenAPIHono,
  workspaceId: WorkspaceId,
  submitter: User,
  question: string,
): Promise<string> {
  const response = await app.request(
    `/workspaces/${workspaceId}/clarifications`,
    asUserJson(submitter.id, 'POST', {
      question,
      candidates: [
        { description: 'merge', sourceReferences: [], proposedOperations: [] },
        { description: 'split', sourceReferences: [], proposedOperations: [] },
      ],
    }),
  )
  expect(response.status).toBe(201)
  const body = await response.json() as { id: string }
  return body.id
}

describe('GET /workspaces/:ws/proposals?showAll=', () => {
  it('filters owner to their own pending by default', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()
    const ownerProposalId = await submitProposal(app, workspaceId, users.owner, 'n-owner')
    const maintainerProposalId = await submitProposal(app, workspaceId, users.maintainer, 'n-maint')

    const response = await app.request(
      `/workspaces/${workspaceId}/proposals?status=pending`,
      { headers: { 'X-Braid-User': users.owner.id } },
    )

    expect(response.status).toBe(200)
    const body = await readJson<PendingItemList>(response)
    const ids = body.items.map(p => p.id)
    expect(ids).toContain(ownerProposalId)
    expect(ids).not.toContain(maintainerProposalId)
  })

  it('shows every pending when the owner sets showAll=true', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()
    const ownerProposalId = await submitProposal(app, workspaceId, users.owner, 'n-owner')
    const maintainerProposalId = await submitProposal(app, workspaceId, users.maintainer, 'n-maint')

    const response = await app.request(
      `/workspaces/${workspaceId}/proposals?status=pending&showAll=true`,
      { headers: { 'X-Braid-User': users.owner.id } },
    )

    expect(response.status).toBe(200)
    const body = await readJson<PendingItemList>(response)
    const ids = body.items.map(p => p.id).sort()
    expect(ids).toEqual([ownerProposalId, maintainerProposalId].sort())
  })

  it('silently falls back to mine-only when a non-owner sets showAll=true', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()
    await submitProposal(app, workspaceId, users.owner, 'n-owner')
    const maintainerProposalId = await submitProposal(app, workspaceId, users.maintainer, 'n-maint')

    const response = await app.request(
      `/workspaces/${workspaceId}/proposals?status=pending&showAll=true`,
      { headers: { 'X-Braid-User': users.maintainer.id } },
    )

    expect(response.status).toBe(200)
    const body = await readJson<PendingItemList>(response)
    const ids = body.items.map(p => p.id)
    expect(ids).toEqual([maintainerProposalId])
  })
})

describe('GET /workspaces/:ws/clarifications?showAll=', () => {
  it('filters owner to their own pending tickets by default', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()
    const ownerTicketId = await submitClarification(app, workspaceId, users.owner, 'owner question?')
    const maintainerTicketId = await submitClarification(app, workspaceId, users.maintainer, 'maintainer question?')

    const response = await app.request(
      `/workspaces/${workspaceId}/clarifications?status=pending`,
      { headers: { 'X-Braid-User': users.owner.id } },
    )

    expect(response.status).toBe(200)
    const body = await readJson<PendingItemList>(response)
    const ids = body.items.map(t => t.id)
    expect(ids).toContain(ownerTicketId)
    expect(ids).not.toContain(maintainerTicketId)
  })

  it('shows every pending ticket when the owner sets showAll=true', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()
    const ownerTicketId = await submitClarification(app, workspaceId, users.owner, 'owner question?')
    const maintainerTicketId = await submitClarification(app, workspaceId, users.maintainer, 'maintainer question?')

    const response = await app.request(
      `/workspaces/${workspaceId}/clarifications?status=pending&showAll=true`,
      { headers: { 'X-Braid-User': users.owner.id } },
    )

    expect(response.status).toBe(200)
    const body = await readJson<PendingItemList>(response)
    const ids = body.items.map(t => t.id).sort()
    expect(ids).toEqual([ownerTicketId, maintainerTicketId].sort())
  })

  it('silently falls back to mine-only when a non-owner sets showAll=true', async () => {
    const { app, workspaceId, users } = await buildMultiUserApp()
    await submitClarification(app, workspaceId, users.owner, 'owner question?')
    const maintainerTicketId = await submitClarification(app, workspaceId, users.maintainer, 'maintainer question?')

    const response = await app.request(
      `/workspaces/${workspaceId}/clarifications?status=pending&showAll=true`,
      { headers: { 'X-Braid-User': users.maintainer.id } },
    )

    expect(response.status).toBe(200)
    const body = await readJson<PendingItemList>(response)
    const ids = body.items.map(t => t.id)
    expect(ids).toEqual([maintainerTicketId])
  })
})
