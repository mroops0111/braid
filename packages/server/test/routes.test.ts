import type { ClarifyTicketId, NodeId, ProposalId, SkillId, WorkspaceId } from '@telos/schema'
import { ClarifyTicket, Proposal } from '@telos/core'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/buildApp.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00'
const workspaceId = 'w-1' as WorkspaceId
const userId = 'u-1'

function makeProposal(overrides: {
  id?: string
  workspaceId?: WorkspaceId
  status?: 'pending' | 'applied' | 'rejected'
  operations?: ConstructorParameters<typeof Proposal>[0]['operations']
}): Proposal {
  return new Proposal({
    id: (overrides.id ?? 'p-1') as ProposalId,
    workspaceId: overrides.workspaceId ?? workspaceId,
    status: overrides.status ?? 'pending',
    operations: overrides.operations ?? [],
    generatedBy: 'extract' as SkillId,
    generatedAt: isoTimestamp,
    rationale: 'r',
  })
}

describe('POST /workspaces/:ws/proposals', () => {
  it('creates a pending proposal with a server-minted id and generatedAt', async () => {
    const { app } = buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          { operation: 'addNode', payload: { type: 'command', name: 'x', id: 'n-1' } },
        ],
        generatedBy: 'extract',
        rationale: 'creating via POST',
      }),
    })

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.status).toBe('pending')
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
    expect(typeof body.generatedAt).toBe('string')
  })

  it('returns 400 when the body is missing required fields', async () => {
    const { app } = buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [] }),
    })

    expect(response.status).toBe(400)
  })
})

describe('POST /workspaces/:ws/clarify', () => {
  it('creates a pending clarify ticket with a server-minted id', async () => {
    const { app } = buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/clarify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'merge or split?',
        candidates: [
          { id: 'c-1', description: 'merge', sourceReferences: [], proposedOperations: [] },
          { id: 'c-2', description: 'split', sourceReferences: [], proposedOperations: [] },
        ],
      }),
    })

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.status).toBe('pending')
    expect(body.candidates).toHaveLength(2)
    expect(typeof body.id).toBe('string')
  })
})

describe('POST /workspaces/:ws/proposals/:id/apply', () => {
  it('applies a seeded proposal and returns a decision', async () => {
    const { app, deps } = buildTestApp()
    await deps.proposalRepository.save(makeProposal({
      operations: [
        { operation: 'addNode', payload: { type: 'command', name: 'x', id: 'n-1' as NodeId } as never },
      ],
    }))

    const response = await app.request(`/workspaces/${workspaceId}/proposals/p-1/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.action).toBe('applyProposal')
  })

  it('returns 404 when the proposal does not exist', async () => {
    const { app } = buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/proposals/missing/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    expect(response.status).toBe(404)
  })

  it('returns 404 when the proposal belongs to a different workspace', async () => {
    const { app, deps } = buildTestApp()
    await deps.proposalRepository.save(makeProposal({ workspaceId: 'other-ws' as WorkspaceId }))

    const response = await app.request(`/workspaces/${workspaceId}/proposals/p-1/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    expect(response.status).toBe(404)
  })

  it('returns 400 when the body is missing required fields', async () => {
    const { app } = buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/proposals/p-1/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
  })
})

describe('GET /workspaces/:ws/proposals', () => {
  it('lists proposals scoped to the workspace, filtered by status', async () => {
    const { app, deps } = buildTestApp()
    await deps.proposalRepository.save(makeProposal({ id: 'p-1', status: 'pending' }))
    await deps.proposalRepository.save(makeProposal({ id: 'p-2', status: 'applied' }))
    await deps.proposalRepository.save(makeProposal({ id: 'p-3', status: 'pending', workspaceId: 'other-ws' as WorkspaceId }))

    const response = await app.request(`/workspaces/${workspaceId}/proposals?status=pending`)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('p-1')
  })
})

describe('POST /workspaces/:ws/clarify/:id/answer', () => {
  it('returns 404 when the ticket does not exist', async () => {
    const { app } = buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/clarify/missing/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: 'c-1', userId }),
    })

    expect(response.status).toBe(404)
  })

  it('returns 400 when the body is missing candidateId', async () => {
    const { app } = buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/clarify/ct-1/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    expect(response.status).toBe(400)
  })
})

describe('POST /workspaces/:ws/clarify/:id/skip', () => {
  it('marks the ticket as skipped', async () => {
    const { app, deps } = buildTestApp()
    await deps.clarifyRepository.save(new ClarifyTicket({
      id: 'ct-1' as ClarifyTicketId,
      workspaceId,
      question: 'irrelevant?',
      candidates: [],
      status: 'pending',
    }))

    const response = await app.request(`/workspaces/${workspaceId}/clarify/ct-1/skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'out of scope', userId }),
    })

    expect(response.status).toBe(200)
  })
})

describe('list endpoints return their empty shape for a fresh workspace', () => {
  const cases = [
    { path: `/workspaces/${workspaceId}/model/snapshot`, empty: { nodes: [], edges: [] } },
    { path: `/workspaces/${workspaceId}/nodes`, empty: { items: [] } },
    { path: `/workspaces/${workspaceId}/edges`, empty: { items: [] } },
    { path: `/workspaces/${workspaceId}/decisions`, empty: { items: [] } },
    { path: '/workspaces', empty: { items: [] } },
  ] as const

  it.each(cases)('GET $path returns 200 + $empty', async ({ path, empty }) => {
    const { app } = buildTestApp()

    const response = await app.request(path)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(empty)
  })
})

describe('GET /workspaces/:ws/nodes filters and lookup', () => {
  it('filters nodes by type, status, and nameContains', async () => {
    const { app, deps } = buildTestApp()
    await deps.modelRepository.applyOperations(workspaceId, [
      { operation: 'addNode', payload: { type: 'command', name: 'voidTask', id: 'n-1' as NodeId } as never },
      { operation: 'addNode', payload: { type: 'command', name: 'cancelTask', id: 'n-2' as NodeId } as never },
      { operation: 'addNode', payload: { type: 'event', name: 'taskVoided', id: 'n-3' as NodeId } as never },
    ])

    const filtered = await app.request(`/workspaces/${workspaceId}/nodes?type=command&q=void`)

    const body = await filtered.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].name).toBe('voidTask')
  })

  it('returns 404 when a single node id is missing', async () => {
    const { app } = buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/nodes/missing`)

    expect(response.status).toBe(404)
  })
})

describe('GET /workspaces/:ws/decisions/:id', () => {
  it('returns 404 when the decision id is missing', async () => {
    const { app } = buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/decisions/missing`)

    expect(response.status).toBe(404)
  })
})

describe('GET /workspaces/:id', () => {
  it('returns 404 when the workspace is not registered', async () => {
    const { app } = buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}`)

    expect(response.status).toBe(404)
  })
})
