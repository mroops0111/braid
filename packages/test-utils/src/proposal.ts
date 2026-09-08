import type { ClarificationId, NodeStatus, NodeTypeId, ProposalId, ProposalStatus, SkillId, SkillRunId, SourceRole, SourceUnit, Timestamp, WorkspaceId } from '@braidhq/schema'
import { Proposal } from '@braidhq/core'
import { mintTestId } from './ids.js'
import { T0 } from './time.js'

export interface MakeProposalOptions {
  readonly id?: string
  readonly name?: string
  readonly rationale?: string
  readonly clarificationId?: string
  /** The run that produced it. Left off, the proposal reads as human-filed. */
  readonly skillRunId?: string
  /** The id of the node it adds, when a test asserts on which one. */
  readonly nodeId?: string
  readonly status?: ProposalStatus
  readonly generatedBy?: string
  readonly reviewedAt?: string
  /** The units it was derived from, each at the version that was read. */
  readonly sourceUnits?: readonly SourceUnit[]
}

/**
 * Construct a pending Proposal for tests.
 * Defaults to a single sourceless addNode with a neutral missing role,
 * a shape that satisfies the EvidenceValidator invariant,
 * without naming an ontology's roles.
 * Override id when a test asserts on it,
 * otherwise a fresh minted id keeps calls collision-free.
 */
export function makeProposal(workspaceId: WorkspaceId, opts: MakeProposalOptions = {}): Proposal {
  const name = opts.name ?? 'voidTask'
  return new Proposal({
    id: (opts.id ?? mintTestId('p')) as ProposalId,
    workspaceId,
    status: opts.status ?? 'pending',
    operations: [{
      operation: 'addNode',
      payload: {
        type: 'command' as NodeTypeId,
        name,
        id: (opts.nodeId ?? mintTestId('n')) as never,
        status: 'draft' as NodeStatus,
        metadata: { sourceReferences: [], missingRoles: ['alpha' as SourceRole] },
      },
    }],
    generatedBy: (opts.generatedBy ?? 'extract') as SkillId,
    generatedAt: T0,
    rationale: opts.rationale ?? 'add voidTask',
    ...(opts.clarificationId ? { clarificationId: opts.clarificationId as ClarificationId } : {}),
    ...(opts.skillRunId ? { skillRunId: opts.skillRunId as SkillRunId } : {}),
    ...(opts.reviewedAt ? { reviewedAt: opts.reviewedAt as Timestamp } : {}),
    ...(opts.sourceUnits ? { sourceUnits: [...opts.sourceUnits] } : {}),
    owner: 'system',
  })
}
