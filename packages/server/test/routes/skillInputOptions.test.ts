import type { ClarificationCandidate, ClarificationId, NodeId, NodeStatus, NodeTypeId, WorkspaceId } from '@braidhq/schema'
import { Clarification } from '@braidhq/core'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../helpers/buildApp.js'
import { readJson } from '../helpers/readJson.js'

const workspaceId = 'w-1' as WorkspaceId

interface OptionsBody {
  items: Array<{ value: string, label: string, description?: string }>
}

describe('GET /workspaces/:ws/skill-input-options', () => {
  it('graph-node returns nodes filtered by types', async () => {
    const { app, deps } = await buildTestApp()
    await deps.modelRepository.applyOperations(workspaceId, [
      {
        operation: 'addNode',
        payload: {
          id: 'cmd.create' as NodeId,
          type: 'command' as NodeTypeId,
          name: 'CreateOrder',
          status: 'draft' as NodeStatus,
          metadata: { sourceReferences: [], intentMissing: true },
        },
      },
      {
        operation: 'addNode',
        payload: {
          id: 'evt.placed' as NodeId,
          type: 'event' as NodeTypeId,
          name: 'OrderPlaced',
          status: 'draft' as NodeStatus,
          metadata: { sourceReferences: [], intentMissing: true },
        },
      },
    ])

    const filter = JSON.stringify({ types: ['command'] })
    const response = await app.request(
      `/workspaces/${workspaceId}/skill-input-options?kind=graph-node&filter=${encodeURIComponent(filter)}`,
    )
    expect(response.status).toBe(200)
    const body = await readJson<OptionsBody>(response)
    expect(body.items).toEqual([
      expect.objectContaining({ value: 'cmd.create', label: 'CreateOrder' }),
    ])
  })

  it('clarify returns tickets filtered by status', async () => {
    const { app, deps } = await buildTestApp()
    const candidate: ClarificationCandidate = {
      id: 'cc-1' as never,
      description: 'Merge',
      sourceReferences: [],
      proposedOperations: [],
    }
    await deps.clarificationRepository.save(new Clarification({
      id: 'ct-pending' as ClarificationId,
      workspaceId,
      question: 'merge or split?',
      candidates: [candidate],
      status: 'pending',
      owner: 'system',
      origin: 'skill',
    }))
    await deps.clarificationRepository.save(new Clarification({
      id: 'ct-answered' as ClarificationId,
      workspaceId,
      question: 'alias or distinct?',
      candidates: [candidate],
      status: 'answered',
      selectedCandidateId: candidate.id,
      owner: 'system',
      origin: 'skill',
    }))

    const filter = JSON.stringify({ status: 'answered' })
    const response = await app.request(
      `/workspaces/${workspaceId}/skill-input-options?kind=clarify&filter=${encodeURIComponent(filter)}`,
    )
    expect(response.status).toBe(200)
    const body = await readJson<OptionsBody>(response)
    expect(body.items).toEqual([
      expect.objectContaining({ value: 'ct-answered', description: 'answered' }),
    ])
  })

  it('source-intent returns empty list when no intent sources are configured', async () => {
    const { app } = await buildTestApp()
    const response = await app.request(
      `/workspaces/${workspaceId}/skill-input-options?kind=source-intent`,
    )
    expect(response.status).toBe(200)
    const body = await readJson<OptionsBody>(response)
    expect(body.items).toEqual([])
  })

  it('rejects an unknown provider type with 400', async () => {
    const { app } = await buildTestApp()
    const response = await app.request(
      `/workspaces/${workspaceId}/skill-input-options?kind=bogus`,
    )
    expect(response.status).toBe(400)
  })
})
