import type {
  DriftIssueId,
  GraphNode,
  NodeId,
  NodeTypeId,
  ProposalId,
  RunRecord,
  SkillId,
  SkillRunId,
  SourceId,
  SourceUnitObservation,
  SourceUnitSha,
  UserId,
} from '@braidhq/schema'
import type { ModelRepository, RunRepository, SkillRegistry, SourceUnitObservationRepository, Workspace } from '../../src/index.js'
import { makeClarification, makeProposal, makeSkillManifest, makeWorkspace, T0 } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { InMemoryClarificationRepository, InMemoryProposalRepository } from '../../src/in-memory.js'
import { CoverageProjection } from '../../src/index.js'

const WORKSPACE = makeWorkspace()
const SOURCE = 'source-a' as SourceId
const UNIT = 'Unit One With Spaces/'
const OLD = 'a'.repeat(64) as SourceUnitSha
const NEW = 'b'.repeat(64) as SourceUnitSha

function observation(sha: SourceUnitSha, path = UNIT): SourceUnitObservation {
  return {
    workspaceId: WORKSPACE.id,
    sourceId: SOURCE,
    path,
    lastObservedSha: sha,
    lastObservedAt: T0,
  }
}

function record(runId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: runId as SkillRunId,
    workspaceId: WORKSPACE.id,
    skillId: 'ddd:extract' as SkillId,
    args: UNIT,
    resumed: false,
    startedBy: 'tester' as UserId,
    startedAt: T0,
    ...overrides,
  }
}

function node(id: string, uri: string, drifts: readonly string[] = []): GraphNode {
  return {
    id: id as NodeId,
    type: 'context' as NodeTypeId,
    name: id,
    status: 'draft',
    metadata: {
      sourceReferences: [{ sourceId: SOURCE, location: { uri } }],
      ...(drifts.length > 0
        ? {
            driftIssues: drifts.map(driftId => ({
              id: driftId as DriftIssueId,
              description: 'spec and code disagree',
              severity: 'warning' as const,
              sourceReferences: [
                { sourceId: SOURCE, location: { uri } },
                { sourceId: SOURCE, location: { uri } },
              ],
              raisedAt: T0,
            })),
          }
        : {}),
    },
  }
}

/** A proposal derived from the unit at a given sha, in a given status. */
function derived(options: {
  id: string
  sha: SourceUnitSha
  status?: 'pending' | 'applied' | 'rejected'
  runId?: string
  skillId?: string
  reviewedAt?: string
  path?: string
}) {
  return makeProposal(WORKSPACE.id, {
    id: options.id,
    status: options.status ?? 'pending',
    sourceUnits: [{ sourceId: SOURCE, path: options.path ?? UNIT, sha: options.sha }],
    ...(options.runId ? { skillRunId: options.runId } : {}),
    ...(options.skillId ? { generatedBy: options.skillId } : {}),
    ...(options.reviewedAt ? { reviewedAt: options.reviewedAt } : {}),
  })
}

function projectionOf(options: {
  building?: boolean
  units?: readonly { value: string, label: string, sourceId: string, sourceName: string, title?: string }[]
  observations?: readonly SourceUnitObservation[]
  proposals?: readonly ReturnType<typeof makeProposal>[]
  clarifications?: readonly ReturnType<typeof makeClarification>[]
  records?: readonly RunRecord[]
  nodes?: readonly GraphNode[]
  skills?: readonly ReturnType<typeof makeSkillManifest>[]
}): CoverageProjection {
  const proposalRepository = new InMemoryProposalRepository()
  for (const proposal of options.proposals ?? [])
    void proposalRepository.save(proposal)
  const clarificationRepository = new InMemoryClarificationRepository()
  for (const clarification of options.clarifications ?? [])
    void clarificationRepository.save(clarification)

  return new CoverageProjection({
    unitLister: async () => options.units ?? [{ value: UNIT, label: UNIT, sourceId: SOURCE, sourceName: 'spec' }],
    sourceUnitObservationRepository: {
      listByWorkspace: async () => options.observations ?? [],
    } as unknown as SourceUnitObservationRepository,
    proposalRepository,
    clarificationRepository,
    runRepository: { listRecords: async () => options.records ?? [] } as unknown as RunRepository,
    modelRepository: { listNodes: async () => [...(options.nodes ?? [])] } as unknown as ModelRepository,
    skillRegistry: { list: async () => options.skills ?? [] } as unknown as SkillRegistry,
    skillRunner: { hasActiveRun: () => options.building ?? false },
  })
}

async function cards(options: Parameters<typeof projectionOf>[0], workspace: Workspace = WORKSPACE) {
  return (await projectionOf(options).board(workspace)).cards
}

describe('coverageProjection', () => {
  it('gives a document nobody has read a card of its own', async () => {
    const [card] = await cards({})
    expect(card).toMatchObject({ path: UNIT, state: 'uncovered', nodeCount: 0 })
  })

  it('names the card by what the document calls itself, not by its path', async () => {
    const [card] = await cards({
      units: [{ value: UNIT, label: UNIT, sourceId: SOURCE, sourceName: 'spec', title: '第一個單元' }],
    })
    expect(card?.name).toBe('第一個單元')
  })

  // The model still rests on it, so losing the card would lose the evidence.
  it('keeps a card for a unit that has left disk but that the model cites', async () => {
    const [card] = await cards({ units: [], observations: [observation(OLD)] })
    expect(card).toMatchObject({ path: UNIT, state: 'uncovered' })
  })

  it('counts a unit covered once a proposal derived from it was applied', async () => {
    const [card] = await cards({
      observations: [observation(OLD)],
      proposals: [derived({ id: 'p-1', sha: OLD, status: 'applied' })],
    })
    expect(card).toMatchObject({ state: 'covered', incorporatedSha: OLD })
  })

  // The hole this whole record exists to close. Reading is not incorporating.
  it('does not call a unit covered when the proposal from it was rejected', async () => {
    const [card] = await cards({
      observations: [observation(NEW)],
      proposals: [derived({ id: 'p-1', sha: NEW, status: 'rejected' })],
    })
    expect(card?.state).toBe('uncovered')
  })

  // Every document taken in before the version was recorded would otherwise
  // read as never read, which is a worse lie than not knowing the version.
  it('counts a unit covered when the graph rests on it, however it got there', async () => {
    const [card] = await cards({
      observations: [observation(OLD)],
      nodes: [node('ctx.a', `intents/source-a/${UNIT}index.md`)],
    })
    expect(card).toMatchObject({ state: 'covered', nodeCount: 1 })
    expect(card?.incorporatedSha).toBeUndefined()
  })

  it('leaves a unit taken in before versions were recorded unjudged on staleness', async () => {
    const [card] = await cards({
      observations: [observation(NEW)],
      nodes: [node('ctx.a', `intents/source-a/${UNIT}index.md`)],
    })
    expect(card?.state).toBe('covered')
  })

  it('calls a unit changed when what was read is not what was applied', async () => {
    const [card] = await cards({
      observations: [observation(NEW)],
      proposals: [
        derived({ id: 'p-1', sha: OLD, status: 'applied' }),
        derived({ id: 'p-2', sha: NEW, status: 'rejected' }),
      ],
    })
    expect(card).toMatchObject({ state: 'sourceChanged', sha: NEW, incorporatedSha: OLD })
  })

  it('puts a unit with a proposal waiting in front of a person', async () => {
    const [card] = await cards({
      observations: [observation(OLD)],
      proposals: [derived({ id: 'p-1', sha: OLD, status: 'pending' })],
    })
    expect(card).toMatchObject({ state: 'awaitingDecision', proposalIds: ['p-1' as ProposalId] })
  })

  it('counts a question its run raised as waiting too', async () => {
    const [card] = await cards({
      observations: [observation(OLD)],
      proposals: [derived({ id: 'p-1', sha: OLD, status: 'applied', runId: 'r-1' })],
      clarifications: [makeClarification(WORKSPACE.id, { id: 'ct-1', skillRunId: 'r-1' })],
      records: [record('r-1', { completedAt: T0, exitCode: 0 })],
    })
    expect(card).toMatchObject({ state: 'awaitingDecision', clarificationIds: ['ct-1'] })
  })

  it('calls a unit conflicted when the nodes resting on it carry drift', async () => {
    const [card] = await cards({
      observations: [observation(OLD)],
      proposals: [derived({ id: 'p-1', sha: OLD, status: 'applied' })],
      nodes: [node('ctx.a', `intents/source-a/${UNIT}index.md`, ['drift-1'])],
    })
    expect(card).toMatchObject({ state: 'conflicted', driftIssueIds: ['drift-1'], nodeCount: 1 })
  })

  // Reading it again settles the change and makes any conflict under it moot,
  // so the cheaper mechanical fix is the one the board asks for first.
  it('puts a changed source ahead of a conflict when both are true', async () => {
    const [card] = await cards({
      observations: [observation(NEW)],
      proposals: [derived({ id: 'p-1', sha: OLD, status: 'applied' })],
      nodes: [node('ctx.a', `intents/source-a/${UNIT}index.md`, ['drift-1'])],
    })
    expect(card?.state).toBe('sourceChanged')
    expect(card?.driftIssueIds).toEqual(['drift-1'])
  })

  // A run that has not proposed yet is still a run, and a document being read
  // right now must not read as untouched.
  it('shows a unit as being read from the run alone, before it has proposed', async () => {
    const [card] = await cards({
      observations: [observation(OLD)],
      records: [record('r-1', { args: UNIT })],
    })
    expect(card).toMatchObject({ state: 'running', lastRun: { runId: 'r-1' } })
  })

  it('shows a run that died before proposing as failed rather than untouched', async () => {
    const [card] = await cards({
      observations: [observation(OLD)],
      records: [record('r-1', { args: UNIT, completedAt: T0, exitCode: 1 })],
    })
    expect(card?.state).toBe('failed')
  })

  it('puts a run in flight ahead of everything else it is also true of', async () => {
    const [card] = await cards({
      observations: [observation(NEW)],
      proposals: [derived({ id: 'p-1', sha: OLD, status: 'pending', runId: 'r-1' })],
      records: [record('r-1')],
    })
    expect(card?.state).toBe('running')
  })

  it('calls a unit failed when its last run ended badly and left nothing waiting', async () => {
    const [card] = await cards({
      observations: [observation(OLD)],
      proposals: [derived({ id: 'p-1', sha: OLD, status: 'rejected', runId: 'r-1' })],
      records: [record('r-1', { completedAt: T0, exitCode: 1 })],
    })
    expect(card).toMatchObject({ state: 'failed', lastRun: { runId: 'r-1', exitCode: 1 } })
  })

  it('counts only the nodes whose evidence points inside this unit', async () => {
    const [card] = await cards({
      observations: [observation(OLD)],
      proposals: [derived({ id: 'p-1', sha: OLD, status: 'applied' })],
      nodes: [
        node('ctx.a', `intents/source-a/${UNIT}index.md`),
        node('ctx.b', 'intents/source-a/Another Unit/index.md'),
      ],
    })
    expect(card?.nodeCount).toBe(1)
  })

  // Filed before the stamp existed, so the run's own arguments stand in. The
  // board would otherwise start blank on every workspace that has one.
  it('attributes a proposal with no stamp by the arguments its run was given', async () => {
    const unstamped = makeProposal(WORKSPACE.id, { id: 'p-old', skillRunId: 'r-1' })
    const [card] = await cards({
      observations: [observation(OLD)],
      proposals: [unstamped],
      records: [record('r-1', { args: UNIT, completedAt: T0, exitCode: 0 })],
    })
    expect(card).toMatchObject({ state: 'awaitingDecision', proposalIds: ['p-old' as ProposalId] })
  })

  it('does not attribute an unstamped proposal whose run named another document', async () => {
    const unstamped = makeProposal(WORKSPACE.id, { id: 'p-old', skillRunId: 'r-1' })
    const [card] = await cards({
      observations: [observation(OLD)],
      proposals: [unstamped],
      records: [record('r-1', { args: 'Another Unit/', completedAt: T0, exitCode: 0 })],
    })
    expect(card?.proposalIds).toEqual([])
  })

  it('reads the stage off the ontology rather than off a list of its own', async () => {
    const [card] = await cards({
      observations: [observation(OLD)],
      proposals: [
        derived({ id: 'p-1', sha: OLD, status: 'applied', skillId: 'ddd:extract' }),
        derived({ id: 'p-2', sha: OLD, status: 'applied', skillId: 'ddd:clarify', reviewedAt: '2026-01-02T00:00:00.000Z' }),
      ],
      skills: [
        makeSkillManifest({ id: 'ddd:extract', category: 'build', order: 100, sourceInput: true }),
        makeSkillManifest({ id: 'ddd:clarify', category: 'build', order: 200 }),
      ],
    })
    expect(card?.stage).toBe('ddd:clarify')
  })

  it('marks a step with no per-unit input as working on the graph as a whole', async () => {
    const board = await projectionOf({
      skills: [
        makeSkillManifest({ id: 'ddd:extract', category: 'build', order: 100, sourceInput: true }),
        makeSkillManifest({ id: 'ddd:reconcile', category: 'build', order: 300 }),
      ],
    }).board(WORKSPACE)
    expect(board.stages.map(stage => [stage.skillId, stage.global])).toEqual([
      ['ddd:extract', false],
      ['ddd:reconcile', true],
    ])
  })

  // Half the pipeline works on the graph rather than on a document, and what
  // it leaves waiting would otherwise be on no card and in no column.
  it('carries what a graph-wide step left waiting on the step itself', async () => {
    const board = await projectionOf({
      proposals: [makeProposal(WORKSPACE.id, { id: 'p-1', skillRunId: 'r-global' })],
      clarifications: [makeClarification(WORKSPACE.id, { id: 'ct-1', skillRunId: 'r-global' })],
      records: [record('r-global', { skillId: 'ddd:reconcile' as SkillId, args: '', completedAt: T0, exitCode: 0 })],
      skills: [makeSkillManifest({ id: 'ddd:reconcile', category: 'build', order: 300 })],
    }).board(WORKSPACE)
    expect(board.stages[0]).toMatchObject({
      skillId: 'ddd:reconcile',
      proposalIds: ['p-1'],
      clarificationIds: ['ct-1'],
    })
  })

  it('leaves a per-document step carrying nothing, since its output sits on the documents', async () => {
    const board = await projectionOf({
      proposals: [derived({ id: 'p-1', sha: OLD, runId: 'r-1' })],
      records: [record('r-1', { args: UNIT })],
      skills: [makeSkillManifest({ id: 'ddd:extract', category: 'build', order: 100, sourceInput: true })],
    }).board(WORKSPACE)
    expect(board.stages[0]).toMatchObject({ global: false, proposalIds: [], clarificationIds: [] })
    expect(board.cards[0]?.proposalIds).toEqual(['p-1'])
  })

  // The surface stops offering what the server would refuse, so the board has
  // to be told, and told by the runner rather than by a record a killed
  // process left without an end.
  it('says whether a build is already under way', async () => {
    expect((await projectionOf({}).board(WORKSPACE)).building).toBe(false)
    expect((await projectionOf({ building: true }).board(WORKSPACE)).building).toBe(true)
  })

  // Which step turns answered questions into changes is the ontology's to
  // declare, so a reader who has worked through a queue is told what to press
  // without this knowing any skill by name.
  it('counts answered questions against the step that declares it reads them', async () => {
    const board = await projectionOf({
      clarifications: [
        makeClarification(WORKSPACE.id, { id: 'ct-1', status: 'answered', selectedCandidateId: 'c-1' as never }),
      ],
      skills: [
        makeSkillManifest({ id: 'ddd:extract', category: 'build', order: 100, sourceInput: true }),
        makeSkillManifest({ id: 'ddd:clarify', category: 'build', order: 200, readsAnswered: true }),
      ],
    }).board(WORKSPACE)
    expect(board.stages.map(stage => [stage.skillId, stage.readsAnswered, stage.answeredIds.length])).toEqual([
      ['ddd:extract', false, 0],
      ['ddd:clarify', true, 1],
    ])
  })

  it('leaves out anything the ontology did not declare as a build step', async () => {
    const board = await projectionOf({
      skills: [
        makeSkillManifest({ id: 'braid:ask', category: 'ask' }),
        makeSkillManifest({ id: 'ddd:scan', category: 'build', order: 50, hidden: true }),
        makeSkillManifest({ id: 'ddd:extract', category: 'build', order: 100 }),
      ],
    }).board(WORKSPACE)
    expect(board.stages.map(stage => stage.skillId)).toEqual(['ddd:extract'])
  })
})
