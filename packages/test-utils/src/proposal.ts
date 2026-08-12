import type { ClarificationId, NodeStatus, NodeTypeId, ProposalId, SkillId, SourceRole, WorkspaceId } from '@braidhq/schema'
import { Proposal } from '@braidhq/core'
import { mintTestId } from './ids.js'
import { T0 } from './time.js'

export interface MakeProposalOptions {
  readonly id?: string
  readonly name?: string
  readonly rationale?: string
  readonly clarificationId?: string
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
    status: 'pending',
    operations: [{
      operation: 'addNode',
      payload: {
        type: 'command' as NodeTypeId,
        name,
        id: mintTestId('n') as never,
        status: 'draft' as NodeStatus,
        metadata: { sourceReferences: [], missingRoles: ['alpha' as SourceRole] },
      },
    }],
    generatedBy: 'extract' as SkillId,
    generatedAt: T0,
    rationale: opts.rationale ?? 'add voidTask',
    ...(opts.clarificationId ? { clarificationId: opts.clarificationId as ClarificationId } : {}),
    owner: 'system',
  })
}
