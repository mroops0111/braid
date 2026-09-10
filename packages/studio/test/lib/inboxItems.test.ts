import type { Clarification, CoverageCard, Proposal, SkillRunId, WorkspaceId } from '@braidhq/schema'
import { makeClarification, makeCoverageCard, makeCoverageRun, makeProposal } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { buildItems } from '@/lib/inboxItems'

const WORKSPACE = 'w-1' as WorkspaceId

// Built through the schema's own factories rather than cast into shape, so a
// field the grouping starts to read cannot go missing here while the surface
// that reads it keeps working.
function asked(id: string, options: { runId?: string, resumes?: boolean } = {}): Clarification {
  const built = makeClarification(WORKSPACE, {
    id,
    ...(options.runId ? { skillRunId: options.runId } : {}),
    answerMode: options.resumes ? 'resumes' : 'standing',
  }).toData()
  return { ...built, question: `q ${id}` }
}

// Spread over a complete record rather than assembled from the few fields the
// grouping reads, so the starting point is always a valid one.
function change(id: string, at: string): Proposal {
  return { ...makeProposal(WORKSPACE, { id, rationale: id }).toData(), generatedAt: at }
}

function inFlight(runId: string): CoverageCard {
  return makeCoverageCard({
    state: 'running',
    lastRun: makeCoverageRun({ runId: runId as SkillRunId }),
  })
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
