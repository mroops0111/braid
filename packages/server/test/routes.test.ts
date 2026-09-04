import type {
  ClarificationCandidate,
  ClarificationId,
  NodeId,
  NodeStatus,
  NodeTypeId,
  ProposalId,
  SkillId,
  SourceRole,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import { PluginRegistry, Proposal } from '@braidhq/core'
import { dddOntology } from '@braidhq/ontology-ddd'
import { makeClarification, T0 } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/buildApp.js'
import { readJson } from './helpers/readJson.js'

const workspaceId = 'w-1' as WorkspaceId
const userId = 'u-1' as UserId

const DRAFT = 'draft' as NodeStatus
const COMMAND = 'command' as NodeTypeId
const EVENT = 'event' as NodeTypeId

function validNodePayload(overrides: { type?: NodeTypeId, name?: string, id?: string } = {}): unknown {
  return {
    type: overrides.type ?? COMMAND,
    name: overrides.name ?? 'x',
    id: overrides.id ?? 'n-1',
    metadata: { sourceReferences: [], missingRoles: ['alpha' as SourceRole] },
  }
}

function makeProposal(overrides: {
  id?: string
  workspaceId?: WorkspaceId
  status?: 'pending' | 'applied' | 'rejected'
  operations?: ConstructorParameters<typeof Proposal>[0]['operations']
} = {}): Proposal {
  return new Proposal({
    id: (overrides.id ?? 'p-1') as ProposalId,
    workspaceId: overrides.workspaceId ?? workspaceId,
    status: overrides.status ?? 'pending',
    operations: overrides.operations ?? [],
    generatedBy: 'extract' as SkillId,
    generatedAt: T0,
    rationale: 'r',
    owner: 'system',
  })
}

interface ProposalBody {
  id: string
  status: string
  generatedAt: string
}

interface ListBody<T> {
  items: T[]
}

interface NodeBody {
  id: string
  name: string
  type: string
}

describe('POST /workspaces/:ws/proposals', () => {
  it('creates a pending proposal with a server-minted id and generatedAt', async () => {
    const { app } = await buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ operation: 'addNode', payload: validNodePayload() }],
        generatedBy: 'extract',
        rationale: 'creating via POST',
      }),
    })

    expect(response.status).toBe(201)
    const body = await readJson<ProposalBody>(response)
    expect(body.status).toBe('pending')
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
    expect(typeof body.generatedAt).toBe('string')
  })

  it('returns 400 when the body is missing required fields', async () => {
    const { app } = await buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [] }),
    })

    expect(response.status).toBe(400)
  })
})

describe('POST /workspaces/:ws/clarifications', () => {
  it('creates a pending clarification with a server-minted id', async () => {
    const { app } = await buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/clarifications`, {
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
    const body = await readJson<{ id: string, status: string, candidates: unknown[] }>(response)
    expect(body.status).toBe('pending')
    expect(body.candidates).toHaveLength(2)
    expect(typeof body.id).toBe('string')
  })

  it('mints candidate ids server-side when the human-authored body omits them', async () => {
    const { app } = await buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/clarifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'org-scoped or user-scoped?',
        candidates: [
          { description: 'org', sourceReferences: [], proposedOperations: [] },
          { description: 'user', sourceReferences: [], proposedOperations: [] },
        ],
      }),
    })

    expect(response.status).toBe(201)
    const body = await readJson<{ candidates: { id: string }[] }>(response)
    expect(body.candidates).toHaveLength(2)
    expect(body.candidates[0]!.id).toMatch(/^clarification-candidate-/)
    expect(body.candidates[1]!.id).toMatch(/^clarification-candidate-/)
    expect(body.candidates[0]!.id).not.toBe(body.candidates[1]!.id)
  })
})

describe('POST /workspaces/:ws/proposals/:id/apply', () => {
  it('applies a seeded proposal and returns the applied proposal', async () => {
    const { app, deps } = await buildTestApp()
    await deps.proposalRepository.save(makeProposal({
      operations: [{
        operation: 'addNode',
        payload: {
          type: COMMAND,
          name: 'x',
          id: 'n-1' as NodeId,
          status: DRAFT,
          metadata: { sourceReferences: [], missingRoles: ['alpha' as SourceRole] },
        },
      }],
    }))

    const response = await app.request(`/workspaces/${workspaceId}/proposals/p-1/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ id: string, status: string }>(response)
    expect(body.status).toBe('applied')
  })

  it('returns 404 when the proposal does not exist', async () => {
    const { app } = await buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/proposals/missing/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    expect(response.status).toBe(404)
  })

  it('returns 404 when the proposal belongs to a different workspace', async () => {
    const { app, deps } = await buildTestApp()
    await deps.proposalRepository.save(makeProposal({ workspaceId: 'other-ws' as WorkspaceId }))

    const response = await app.request(`/workspaces/${workspaceId}/proposals/p-1/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    expect(response.status).toBe(404)
  })

  // Apply body has no required fields, userId comes from `X-Braid-User` now, with a body shim during deprecation.
  // Reject still validates its body, see the /reject suite for the required-field path.
})

describe('GET /workspaces/:ws/proposals', () => {
  it('lists proposals scoped to the workspace, filtered by status', async () => {
    const { app, deps } = await buildTestApp()
    await deps.proposalRepository.save(makeProposal({ id: 'p-1', status: 'pending' }))
    await deps.proposalRepository.save(makeProposal({ id: 'p-2', status: 'applied' }))
    await deps.proposalRepository.save(makeProposal({ id: 'p-3', status: 'pending', workspaceId: 'other-ws' as WorkspaceId }))

    const response = await app.request(`/workspaces/${workspaceId}/proposals?status=pending`)

    expect(response.status).toBe(200)
    const body = await readJson<ListBody<{ id: string }>>(response)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.id).toBe('p-1')
  })
})

describe('POST /workspaces/:ws/clarifications/:id/answer', () => {
  it('returns 404 when the clarification does not exist', async () => {
    const { app } = await buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/clarifications/missing/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: 'c-1', userId }),
    })

    expect(response.status).toBe(404)
  })

  it('returns 400 when the body has neither candidateId nor customCandidate', async () => {
    const { app } = await buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/clarifications/ct-1/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })

    expect(response.status).toBe(400)
  })

  it('returns 400 when the body has both candidateId and customCandidate', async () => {
    const { app } = await buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/clarifications/ct-1/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: 'cc-1', customCandidate: { description: 'x' }, userId }),
    })

    expect(response.status).toBe(400)
  })

  it('appends a custom candidate to the clarification and answers with it in one round-trip', async () => {
    const { app, deps } = await buildTestApp()
    await deps.clarificationRepository.save(makeClarification(workspaceId, {
      id: 'ct-custom',
      candidates: [{ id: 'cc-1' as ClarificationCandidate['id'], description: 'pre', sourceReferences: [], proposedOperations: [] }],
    }))

    const response = await app.request(`/workspaces/${workspaceId}/clarifications/ct-custom/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customCandidate: { description: 'actually it should be hybrid' },
        userId,
        note: 'security review override',
      }),
    })

    expect(response.status).toBe(200)
    const reloaded = await deps.clarificationRepository.load('ct-custom' as ClarificationId)
    expect(reloaded.status).toBe('answered')
    expect(reloaded.candidates).toHaveLength(2)
    expect(reloaded.candidates[1]!.description).toBe('actually it should be hybrid')
    expect(reloaded.selectedCandidateId).toBe(reloaded.candidates[1]!.id)
  })
})

describe('PATCH /workspaces/:ws/clarifications/:id', () => {
  it('moves an answered clarification to applied and stamps proposalId', async () => {
    const { app, deps } = await buildTestApp()
    await deps.clarificationRepository.save(makeClarification(workspaceId, { id: 'ct-link', status: 'answered' }))

    const response = await app.request(`/workspaces/${workspaceId}/clarifications/ct-link`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'applied', proposalId: 'p-99', userId }),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ status: string, proposalId?: string }>(response)
    expect(body.status).toBe('applied')
    expect(body.proposalId).toBe('p-99')

    const reloaded = await deps.clarificationRepository.load('ct-link' as ClarificationId)
    expect(reloaded.status).toBe('applied')
    expect(reloaded.proposalId).toBe('p-99')
  })

  it('moves an answered clarification to applied without proposalId for no-impact resolutions', async () => {
    const { app, deps } = await buildTestApp()
    await deps.clarificationRepository.save(makeClarification(workspaceId, { id: 'ct-noop', status: 'answered' }))

    const response = await app.request(`/workspaces/${workspaceId}/clarifications/ct-noop`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'applied', userId }),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ status: string, proposalId?: string }>(response)
    expect(body.status).toBe('applied')
    expect(body.proposalId).toBeUndefined()

    const reloaded = await deps.clarificationRepository.load('ct-noop' as ClarificationId)
    expect(reloaded.status).toBe('applied')
    expect(reloaded.proposalId).toBeUndefined()
  })

  it('returns 400 when status is missing', async () => {
    const { app, deps } = await buildTestApp()
    await deps.clarificationRepository.save(makeClarification(workspaceId, { id: 'ct-link', status: 'answered' }))

    const response = await app.request(`/workspaces/${workspaceId}/clarifications/ct-link`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId: 'p-99', userId }),
    })

    expect(response.status).toBe(400)
  })

  it('returns 409 when clarification has not been answered yet', async () => {
    const { app, deps } = await buildTestApp()
    await deps.clarificationRepository.save(makeClarification(workspaceId, { id: 'ct-pending', status: 'pending' }))

    const response = await app.request(`/workspaces/${workspaceId}/clarifications/ct-pending`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'applied', proposalId: 'p-99', userId }),
    })

    expect(response.status).toBe(409)
  })
})

describe('POST /workspaces/:ws/clarifications/:id/skip', () => {
  it('marks the clarification as skipped', async () => {
    const { app, deps } = await buildTestApp()
    await deps.clarificationRepository.save(makeClarification(workspaceId, { id: 'ct-1', status: 'pending' }))

    const response = await app.request(`/workspaces/${workspaceId}/clarifications/ct-1/skip`, {
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
    // `total` rides along,
    // so an empty answer reads differently from a truncated one.
    { path: `/workspaces/${workspaceId}/nodes`, empty: { items: [], total: 0 } },
    { path: `/workspaces/${workspaceId}/edges`, empty: { items: [] } },
    { path: `/workspaces/${workspaceId}/source-unit-states`, empty: { items: [] } },
  ] as const

  it.each(cases)('GET $path returns 200 + $empty', async ({ path, empty }) => {
    const { app } = await buildTestApp()

    const response = await app.request(path)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(empty)
  })

  it('GET /workspaces returns 200 + items=[] when none registered', async () => {
    const { app } = await buildTestApp({ workspaceIds: [] })

    const response = await app.request('/workspaces')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
  })
})

describe('GET /workspaces/:ws/nodes filters and lookup', () => {
  it('filters nodes by type, status, and a text substring', async () => {
    // A type filter is checked against the workspace's ontology,
    // so this needs the one its manifest names.
    const registry = new PluginRegistry()
    registry.register(dddOntology)
    const { app, deps } = await buildTestApp({ pluginRegistry: registry })
    await deps.modelRepository.applyOperations(workspaceId, [
      { operation: 'addNode', payload: { type: COMMAND, name: 'voidTask', id: 'n-1' as NodeId, status: DRAFT } },
      { operation: 'addNode', payload: { type: COMMAND, name: 'cancelTask', id: 'n-2' as NodeId, status: DRAFT } },
      { operation: 'addNode', payload: { type: EVENT, name: 'taskVoided', id: 'n-3' as NodeId, status: DRAFT } },
    ])

    const filtered = await app.request(`/workspaces/${workspaceId}/nodes?type=command&q=void`)

    const body = await readJson<ListBody<NodeBody>>(filtered)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.name).toBe('voidTask')
  })

  it('returns 404 when a single node id is missing', async () => {
    const { app } = await buildTestApp()

    const response = await app.request(`/workspaces/${workspaceId}/nodes/missing`)

    expect(response.status).toBe(404)
  })
})

describe('GET /workspaces/:id', () => {
  it('returns 404 when the workspace is not registered', async () => {
    const { app } = await buildTestApp({ workspaceIds: [] })

    const response = await app.request(`/workspaces/${workspaceId}`)

    expect(response.status).toBe(404)
  })
})
