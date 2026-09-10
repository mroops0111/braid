import type {
  ClarificationId,
  CoverageBoard,
  CoverageCard,
  CoverageRun,
  CoverageStage,
  CoverageState,
  DriftIssueId,
  GraphNode,
  RunRecord,
  SkillManifest as SkillManifestData,
  SourceId,
  SourceUnitObservation,
} from '@braidhq/schema'
import type { Clarification } from '../domain/hitl/Clarification.js'
import type { ClarificationRepository } from '../domain/hitl/ClarificationRepository.js'
import type { Proposal } from '../domain/hitl/Proposal.js'
import type { ProposalRepository } from '../domain/hitl/ProposalRepository.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { RunRepository } from '../domain/skill/RunRepository.js'
import type { SkillRegistry } from '../domain/skill/SkillRegistry.js'
import type { SkillRunner } from '../domain/skill/SkillRunner.js'
import type { SourceUnitObservationRepository } from '../domain/source/SourceUnitObservationRepository.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { UnitLister } from './BatchService.js'
import { COVERAGE_STATE_PRECEDENCE } from '@braidhq/schema'
import { runScope } from '../domain/skill/runScope.js'

export interface CoverageProjectionDeps {
  readonly unitLister: UnitLister
  readonly sourceUnitObservationRepository: SourceUnitObservationRepository
  readonly proposalRepository: ProposalRepository
  readonly clarificationRepository: ClarificationRepository
  readonly runRepository: RunRepository
  readonly modelRepository: ModelRepository
  readonly skillRegistry: SkillRegistry
  /**
   * Asked whether a build is already running. Absent, the board reports none,
   * which is right for a composition with no runner to start one.
   */
  readonly skillRunner?: Pick<SkillRunner, 'hasActiveRun'>
}

/** Everything true of one unit at once, before precedence picks a single state. */
export interface UnitFacts {
  readonly running: boolean
  readonly awaitingDecision: boolean
  readonly failed: boolean
  readonly sourceChanged: boolean
  readonly conflicted: boolean
  readonly covered: boolean
}

/**
 * Every source document, and what the model has made of it.
 *
 * This answers the question somebody actually opens the surface with, which is
 * what the model still does not know and what is being done about it. A list
 * of runs answers a question nobody asks, because a document read three times
 * and failed twice is one thing a reader is tracking rather than five.
 *
 * Read-only over records that already exist. Nothing writes a board, so it
 * holds no state its sources could contradict, and every state is derived here
 * rather than reported by whatever produced the record.
 *
 * Ontology-neutral. Which sources yield units is the ontology's declaration,
 * carried in by `unitLister`, and the pipeline is read off its own build
 * skills. The states are mechanical, so swapping the ontology changes the
 * stages on the cards and nothing else here.
 */
export class CoverageProjection {
  constructor(private readonly deps: CoverageProjectionDeps) {}

  async board(workspace: Workspace): Promise<CoverageBoard> {
    const [units, observations, proposals, clarifications, records, nodes, skills] = await Promise.all([
      this.deps.unitLister(workspace),
      this.deps.sourceUnitObservationRepository.listByWorkspace(workspace.id),
      this.deps.proposalRepository.list(),
      this.deps.clarificationRepository.list(),
      this.deps.runRepository.listRecords(workspace),
      this.deps.modelRepository.listNodes(workspace.id),
      this.deps.skillRegistry.list(workspace),
    ])

    const stages = readStages(skills).map(stage => withGraphWideOutput(stage, {
      proposals,
      clarifications,
      records,
    }))
    const runsById = new Map(records.map(record => [record.runId as string, record]))
    const seeds = new Map<string, { sourceId: SourceId, path: string, name: string }>()

    // On-disk units first, so a document nobody has read yet still gets a card.
    // Observations then fill in anything that has left disk but that the model
    // still rests on, which a reader needs to see rather than silently lose.
    for (const unit of units) {
      seeds.set(keyOf(unit.sourceId, unit.value), {
        sourceId: unit.sourceId as SourceId,
        path: unit.value,
        name: unit.title ?? unit.label,
      })
    }
    for (const observation of observations) {
      const key = keyOf(observation.sourceId, observation.path)
      if (!seeds.has(key))
        seeds.set(key, { sourceId: observation.sourceId, path: observation.path, name: observation.path })
    }

    const cards = [...seeds.values()].map(seed => buildCard({
      seed,
      observation: observations.find(item => item.sourceId === seed.sourceId && item.path === seed.path),
      proposals,
      clarifications,
      records,
      runsById,
      nodes,
      stages,
    }))

    return {
      workspaceId: workspace.id,
      stages,
      cards,
      // Read from the runner rather than from the records, because a record
      // left without an end by a killed process would wedge the board shut
      // for good, while the runner's own set empties when the process does.
      building: this.deps.skillRunner?.hasActiveRun(workspace.id, 'build') ?? false,
    }
  }
}

interface CardContext {
  readonly seed: { readonly sourceId: SourceId, readonly path: string, readonly name: string }
  readonly observation: SourceUnitObservation | undefined
  readonly proposals: readonly Proposal[]
  readonly clarifications: readonly Clarification[]
  readonly records: readonly RunRecord[]
  readonly runsById: Map<string, RunRecord>
  readonly nodes: readonly GraphNode[]
  readonly stages: readonly CoverageStage[]
}

function buildCard(context: CardContext): CoverageCard {
  const { sourceId, path, name } = context.seed
  const mine = context.proposals.filter(proposal => derivedFrom(proposal, sourceId, path, context.runsById))
  const pending = mine.filter(proposal => proposal.status === 'pending')
  const incorporated = latestIncorporation(mine)

  // Runs are attributed by what they were pointed at, not by what they went on
  // to produce. Reaching them through proposals would leave a run invisible
  // until it proposed, so a document being read right now, or one whose run
  // died before proposing, would both look untouched.
  const runs = context.records.filter((record) => {
    const scope = runScope(record)
    return scope.length > 0 && scope.includes(path)
  })
  const runIds = new Set([
    ...runs.map(record => record.runId as string),
    ...mine.flatMap(proposal => (proposal.skillRunId ? [proposal.skillRunId as string] : [])),
  ])
  const asked = context.clarifications.filter(
    clarification => clarification.status === 'pending'
      && clarification.skillRunId !== undefined
      && runIds.has(clarification.skillRunId),
  )

  const citing = context.nodes.filter(node => citesUnit(node, sourceId, path))
  const drifts = citing.flatMap(node => (node.metadata.driftIssues ?? []).map(issue => issue.id))
  const lastRun = latestRun(runIds, context.runsById)
  const stage = furthestStage(mine, context.stages)

  const facts: UnitFacts = {
    running: lastRun !== undefined && lastRun.completedAt === undefined,
    awaitingDecision: pending.length > 0 || asked.length > 0,
    failed: lastRun?.exitCode !== undefined && lastRun.exitCode !== 0,
    // Reading a unit is not incorporating it. Comparing what was last read
    // against what was last applied is what stops a rejected proposal leaving
    // the unit looking current while the model reflects none of it. A document
    // taken in before this was recorded has no version to compare, and is left
    // unjudged rather than accused of being stale.
    sourceChanged: incorporated !== undefined
      && context.observation !== undefined
      && context.observation.lastObservedSha !== incorporated.sha,
    conflicted: drifts.length > 0,
    // The graph is itself the evidence of incorporation. A node citing this
    // document is the model having taken it in, whether or not the proposal
    // that did so recorded which version it read. Resting only on the stamp
    // would call a fully modelled workspace empty until every document had
    // been read again, which is a worse lie than not knowing the version.
    covered: incorporated !== undefined || citing.length > 0,
  }

  return {
    sourceId,
    path,
    name,
    state: pick(facts),
    ...(context.observation ? { sha: context.observation.lastObservedSha } : {}),
    ...(incorporated ? { incorporatedSha: incorporated.sha, incorporatedAt: incorporated.at } : {}),
    ...(lastRun ? { lastRun } : {}),
    ...(stage ? { stage } : {}),
    proposalIds: pending.map(proposal => proposal.id),
    clarificationIds: asked.map(clarification => clarification.id) as ClarificationId[],
    driftIssueIds: drifts as DriftIssueId[],
    nodeIds: citing.map(node => node.id),
  }
}

function keyOf(sourceId: string, path: string): string {
  return `${sourceId} ${path}`
}

/**
 * The one state a card shows, from everything true of it.
 *
 * Ordered by `COVERAGE_STATE_PRECEDENCE` rather than by whichever check runs
 * first, so a unit that is both changed at source and holding a conflict lands
 * in the same column every time.
 */
function pick(facts: UnitFacts): CoverageState {
  for (const state of COVERAGE_STATE_PRECEDENCE) {
    if (state === 'covered')
      break
    if (state === 'uncovered') {
      if (!facts.covered)
        return 'uncovered'
      continue
    }
    if (facts[state])
      return state
  }
  return 'covered'
}

/**
 * Whether this proposal came from this document.
 *
 * The stamp is the answer when it is there. A proposal filed before the stamp
 * existed falls back to the arguments of the run that made it, which is the
 * same fact the stamp is derived from and just as much the server's own, so
 * the board reads a workspace's history rather than only its future.
 */
function derivedFrom(
  proposal: Proposal,
  sourceId: SourceId,
  path: string,
  runsById: Map<string, RunRecord>,
): boolean {
  const stamped = proposal.sourceUnits
  if (stamped !== undefined)
    return stamped.some(unit => unit.sourceId === sourceId && unit.path === path)
  const record = proposal.skillRunId ? runsById.get(proposal.skillRunId) : undefined
  return record !== undefined && runScope(record).length > 0 && runScope(record).includes(path)
}

/** The version of this unit the model last actually took in. */
function latestIncorporation(proposals: readonly Proposal[]): { sha: CoverageCard['sha'], at: string } | undefined {
  let best: { sha: CoverageCard['sha'], at: string } | undefined
  for (const proposal of proposals) {
    if (proposal.status !== 'applied')
      continue
    const unit = (proposal.sourceUnits ?? [])[0]
    const at = proposal.reviewedAt ?? proposal.generatedAt
    if (unit && (best === undefined || at > best.at))
      best = { sha: unit.sha, at }
  }
  return best
}

function latestRun(runIds: ReadonlySet<string>, runsById: Map<string, RunRecord>): CoverageRun | undefined {
  let best: RunRecord | undefined
  for (const runId of runIds) {
    const record = runsById.get(runId)
    if (record && (best === undefined || record.startedAt > best.startedAt))
      best = record
  }
  if (!best)
    return undefined
  return {
    runId: best.runId,
    skillId: best.skillId,
    startedAt: best.startedAt,
    ...(best.completedAt ? { completedAt: best.completedAt } : {}),
    ...(best.exitCode !== undefined ? { exitCode: best.exitCode } : {}),
  }
}

// The furthest declared step any proposal for this unit came from. A skill the
// ontology does not declare leaves the stage unsaid rather than inventing one.
function furthestStage(proposals: readonly Proposal[], stages: readonly CoverageStage[]): CoverageStage['skillId'] | undefined {
  let best: CoverageStage | undefined
  for (const proposal of proposals) {
    const stage = stages.find(candidate => candidate.skillId === proposal.generatedBy)
    if (stage && (best === undefined || stage.order > best.order))
      best = stage
  }
  return best?.skillId
}

/**
 * Whether a node's evidence points inside this unit.
 *
 * Matched on the unit path appearing in the reference's uri, because a
 * reference records where it was read rather than which unit it belongs to,
 * and every loader lays a unit out as a directory of that name. A miss leaves
 * the count low rather than attributing evidence to the wrong document.
 */
function citesUnit(node: GraphNode, sourceId: SourceId, path: string): boolean {
  return node.metadata.sourceReferences.some(
    reference => reference.sourceId === sourceId && reference.location.uri.includes(path),
  )
}

/**
 * The ontology's own build pipeline, in the order it declared.
 *
 * A step is per-unit when one of its inputs is fed by the source provider,
 * which is how `extract` earns a place in the flow and `reconcile` is known to
 * work on the graph as a whole. Read from the declaration rather than from a
 * list of skill ids here, so a different ontology brings its own pipeline.
 */
/**
 * What a graph-wide step left waiting.
 *
 * Attributed by the run naming no document, which is the same rule that keeps
 * such a run off every card. A per-document step carries nothing here, since
 * everything it produced already sits on the document it read.
 */
function withGraphWideOutput(stage: CoverageStage, context: {
  proposals: readonly Proposal[]
  clarifications: readonly Clarification[]
  records: readonly RunRecord[]
}): CoverageStage {
  // Everything already answered and waiting for the step that reads them.
  // Which step that is comes from its own declared input, so a different
  // ontology names a different one without this knowing either.
  const answeredIds = stage.readsAnswered
    ? context.clarifications.filter(item => item.status === 'answered').map(item => item.id)
    : []
  if (!stage.global)
    return { ...stage, answeredIds }
  const runIds = new Set(
    context.records
      .filter(record => record.skillId === stage.skillId && runScope(record).length === 0)
      .map(record => record.runId as string),
  )
  const lastRun = latestRun(runIds, new Map(context.records.map(record => [record.runId as string, record])))
  return {
    ...stage,
    answeredIds,
    ...(lastRun ? { lastRun } : {}),
    proposalIds: context.proposals
      .filter(proposal => proposal.status === 'pending' && proposal.skillRunId !== undefined && runIds.has(proposal.skillRunId))
      .map(proposal => proposal.id),
    clarificationIds: context.clarifications
      .filter(item => item.status === 'pending' && item.skillRunId !== undefined && runIds.has(item.skillRunId))
      .map(item => item.id) as CoverageStage['clarificationIds'],
  }
}

function readStages(skills: readonly SkillManifestData[]): CoverageStage[] {
  return skills
    .filter(skill => skill.frontmatter.braid?.category === 'build' && !skill.frontmatter.braid.hidden)
    .map(skill => ({
      skillId: skill.id,
      order: skill.frontmatter.braid?.order ?? 0,
      ...(skill.frontmatter.braid?.label ? { label: skill.frontmatter.braid.label } : {}),
      ...(skill.frontmatter.braid?.summary ? { summary: skill.frontmatter.braid.summary } : {}),
      global: !(skill.frontmatter.braid?.inputs ?? []).some(
        input => input.kind !== 'text' && input.provider.kind === 'source',
      ),
      readsAnswered: (skill.frontmatter.braid?.inputs ?? []).some(
        input => input.kind !== 'text'
          && input.provider.kind === 'clarify'
          && input.provider.filter?.status === 'answered',
      ),
      proposalIds: [],
      clarificationIds: [],
      answeredIds: [],
    }))
    .sort((a, b) => a.order - b.order)
}
