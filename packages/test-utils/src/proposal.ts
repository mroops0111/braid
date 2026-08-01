import type { NodeStatus, NodeTypeId, ProposalId, SkillId, WorkspaceId } from '@braidhq/schema'
import { Proposal } from '@braidhq/core'
import { mintTestId } from './ids.js'
import { T0 } from './time.js'

export interface MakeProposalOptions {
  readonly id?: string
  readonly name?: string
  readonly rationale?: string
}

/**
 * Construct a pending Proposal for tests.
 * Defaults to a single addNode with implementationMissing,
 * the intent-side shape that satisfies the EvidenceValidator invariant.
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
        metadata: { sourceReferences: [], implementationMissing: true },
      },
    }],
    generatedBy: 'extract' as SkillId,
    generatedAt: T0,
    rationale: opts.rationale ?? 'add voidTask',
    owner: 'system',
  })
}
