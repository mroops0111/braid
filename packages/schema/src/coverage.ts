import { z } from 'zod'
import { ClarificationId, DriftIssueId, NodeId, ProposalId, SkillId, SkillRunId, SourceId, Timestamp, WorkspaceId } from './common.js'
import { localizedText } from './locale.js'
import { SourceUnitSha } from './source-unit.js'

/**
 * Where one source unit stands in relation to the model.
 *
 * Mechanical rather than semantic, so it holds for any ontology. What a unit
 * means, and which steps it passes through, are the ontology's to declare, and
 * ride on `stage` instead.
 *
 * `sourceChanged` and `conflicted` are two different kinds of out of date and
 * are kept apart on purpose. A changed source is fixed by reading it again,
 * which is mechanical. A conflict is the model and its evidence disagreeing,
 * which needs a person to say which is right.
 */
export const CoverageState = z.enum([
  'uncovered',
  'running',
  'awaitingDecision',
  'failed',
  'sourceChanged',
  'conflicted',
  'covered',
])
export type CoverageState = z.infer<typeof CoverageState>

/**
 * The order a card is judged in when more than one state is true.
 *
 * A unit can be both changed at source and holding a conflict, and the board
 * has one column per card, so the tie has to be broken somewhere stated rather
 * than by whichever check happened to run first. Reading again settles a
 * changed source and makes any conflict under it moot, so it comes first.
 */
export const COVERAGE_STATE_PRECEDENCE: readonly CoverageState[] = [
  'running',
  'awaitingDecision',
  'failed',
  'sourceChanged',
  'conflicted',
  'uncovered',
  'covered',
]

/** The last run against a unit, enough to reach it without a second request. */
export const CoverageRun = z.object({
  runId: SkillRunId,
  skillId: SkillId,
  startedAt: Timestamp,
  completedAt: Timestamp.optional(),
  exitCode: z.number().int().optional(),
})
export type CoverageRun = z.infer<typeof CoverageRun>

/**
 * One source document, and what the model has made of it.
 *
 * The card is the document rather than the run, because a document read three
 * times and failed twice is still one thing a reader is tracking.
 */
export const CoverageCard = z.object({
  sourceId: SourceId,
  /** Unit path, keeping the trailing-slash convention so keys round-trip. */
  path: z.string().min(1),
  name: z.string().min(1),
  state: CoverageState,
  /** What the unit hashes to on disk now. Absent once it is gone from disk. */
  sha: SourceUnitSha.optional(),
  /** The version the model actually took in, from the latest applied proposal. */
  incorporatedSha: SourceUnitSha.optional(),
  incorporatedAt: Timestamp.optional(),
  lastRun: CoverageRun.optional(),
  /** The build step this unit last passed, named by the ontology, not by us. */
  stage: SkillId.optional(),
  proposalIds: z.array(ProposalId),
  clarificationIds: z.array(ClarificationId),
  driftIssueIds: z.array(DriftIssueId),
  /**
   * The nodes whose evidence points inside this document.
   *
   * Carried rather than counted, because a reader who sees that twelve nodes
   * rest on a document wants to look at those twelve, and the count alone
   * makes them go and find them.
   */
  nodeIds: z.array(NodeId),
})
export type CoverageCard = z.infer<typeof CoverageCard>

/**
 * One step of the pipeline the workspace's ontology declares.
 *
 * A step that works on the graph as a whole names no document, so what it
 * leaves waiting has no card to sit on. It is carried here instead, because a
 * board that silently drops the output of half its pipeline is worse than one
 * that has no pipeline at all.
 */
export const CoverageStage = z.object({
  skillId: SkillId,
  /** What to call this step, as the ontology declared it. Absent falls back to the id. */
  label: localizedText(z.string().min(1).max(40)).optional(),
  order: z.number().int(),
  summary: z.string().optional(),
  /** True when the step works on the graph as a whole rather than on a unit. */
  global: z.boolean(),
  /**
   * True when this step is the one that turns answered questions into
   * changes, read from its own declared input rather than named here. It is
   * what a reader who has just worked through a queue needs to press.
   */
  readsAnswered: z.boolean(),
  /** What this step left waiting, when it belongs to no single document. */
  proposalIds: z.array(ProposalId),
  clarificationIds: z.array(ClarificationId),
  /**
   * Answered questions this step would turn into changes, when it is the one
   * that reads them. Somebody who has worked through a queue of standing
   * questions needs to know there is something to run, and this is the count
   * that says so.
   */
  answeredIds: z.array(ClarificationId),
})
export type CoverageStage = z.infer<typeof CoverageStage>

/**
 * Every source document, and the pipeline it travels.
 *
 * The stages are read off the ontology's own build skills, so a workspace that
 * swaps its ontology gets that ontology's pipeline without this shape or the
 * surface knowing anything about either one.
 */
export const CoverageBoard = z.object({
  workspaceId: WorkspaceId,
  stages: z.array(CoverageStage),
  cards: z.array(CoverageCard),
  /**
   * Whether a build is already under way here.
   *
   * The graph only accumulates, so builds run one at a time and the server
   * refuses a second. Saying so here is what lets the surface stop offering
   * what would be refused, rather than letting a person find out by error.
   */
  building: z.boolean(),
})
export type CoverageBoard = z.infer<typeof CoverageBoard>
