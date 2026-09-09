import type { Clarification, CoverageCard, Proposal } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { buildItems } from '@/pages/Inbox'

function asked(id: string, options: { runId?: string, resumes?: boolean } = {}): Clarification {
  return {
    id,
    workspaceId: 'w-1',
    question: `q ${id}`,
    candidates: [],
    status: 'pending',
    owner: 'system',
    origin: 'skill',
    ...(options.runId ? { skillRunId: options.runId } : {}),
    ...(options.resumes ? { answerMode: 'resumes' } : {}),
  } as unknown as Clarification
}

function change(id: string, at: string): Proposal {
  return { id, generatedAt: at, rationale: id, generatedBy: 'ddd:extract' } as unknown as Proposal
}

function inFlight(runId: string): CoverageCard {
  return { name: 'a doc', state: 'running', lastRun: { runId, skillId: 'ddd:extract' } } as unknown as CoverageCard
}

describe('buildItems', () => {
  // One run is one interrupt, so its questions share an item and are answered
  // together. Splitting them would invite resuming on the first.
  it('gathers a parked run into one item, however many questions it holds', () => {
    const items = buildItems({
      pending: [
        asked('ct-1', { runId: 'r-1', resumes: true }),
        asked('ct-2', { runId: 'r-1', resumes: true }),
      ],
      proposals: [],
      running: [],
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'parked', id: 'r-1' })
  })

  it('keeps two parked runs apart', () => {
    const items = buildItems({
      pending: [
        asked('ct-1', { runId: 'r-1', resumes: true }),
        asked('ct-2', { runId: 'r-2', resumes: true }),
      ],
      proposals: [],
      running: [],
    })
    expect(items.map(item => item.id)).toEqual(['r-1', 'r-2'])
  })

  // Nothing waits on a standing question, so nothing groups it either.
  it('gives every standing question an item of its own', () => {
    const items = buildItems({
      pending: [asked('ct-1', { runId: 'r-1' }), asked('ct-2', { runId: 'r-1' })],
      proposals: [],
      running: [],
    })
    expect(items.map(item => item.kind)).toEqual(['question', 'question'])
  })

  it('treats a question no run raised as standing', () => {
    const items = buildItems({ pending: [asked('ct-1')], proposals: [], running: [] })
    expect(items[0]).toMatchObject({ kind: 'question', id: 'ct-1' })
  })

  // In flight first, because it is the thing most likely to need somebody
  // next, then what waits, then changes newest first.
  it('orders in flight, then waiting, then changes newest first', () => {
    const items = buildItems({
      pending: [asked('ct-1', { runId: 'r-1', resumes: true })],
      proposals: [change('p-old', '2026-01-01T00:00:00.000Z'), change('p-new', '2026-02-01T00:00:00.000Z')],
      running: [inFlight('r-9')],
    })
    expect(items.map(item => item.id)).toEqual(['r-9', 'r-1', 'p-new', 'p-old'])
  })
})
