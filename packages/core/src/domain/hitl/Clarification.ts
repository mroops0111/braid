import type {
  Actor,
  ClarificationCandidate,
  ClarificationCandidateId,
  Clarification as ClarificationData,
  ClarificationId,
  ClarificationStatus,
  ExternalReference,
  GraphOperation,
  ProposalId,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import { ConflictError, NotFoundError } from '../errors.js'

/**
 * Lifecycle. From pending a ticket is either answered then applied, or skipped.
 *
 * `markAnswered` records the user's choice but does NOT mutate the graph,
 * the resolution is snapshotted onto the ticket and the ddd:clarify skill is expected to wrap it into a Proposal.
 * Once that Proposal lands the ticket transitions to `applied` via `markApplied`,
 * which only stamps the (optional) proposalId, the actual graph mutation happens inside `HITLService.applyProposal`.
 * proposalId is omitted when the chosen candidate's resolution had no graph impact, so no Proposal was produced.
 *
 * Keeping these two transitions distinct preserves the invariant that only HITLService.applyProposal writes Kùzu.
 * Clarification answers go through the same review gate as any other agent output.
 */
export class Clarification {
  constructor(private readonly data: ClarificationData) {}

  get id(): ClarificationId { return this.data.id }
  get workspaceId(): WorkspaceId { return this.data.workspaceId }
  get question(): string { return this.data.question }
  get candidates(): readonly ClarificationCandidate[] { return this.data.candidates }
  get status(): ClarificationStatus { return this.data.status }
  get selectedCandidateId(): ClarificationCandidateId | undefined { return this.data.selectedCandidateId }
  get resolution(): readonly GraphOperation[] | undefined { return this.data.resolution }
  get proposalId(): ProposalId | undefined { return this.data.proposalId }
  get owner(): Actor { return this.data.owner }
  get ownerDisplayName(): string | undefined { return this.data.ownerDisplayName }
  get externalReferences(): readonly ExternalReference[] | undefined { return this.data.externalReferences }

  resolveCandidate(candidateId: ClarificationCandidateId): readonly GraphOperation[] {
    const match = this.data.candidates.find(candidate => candidate.id === candidateId)
    if (!match) {
      throw new NotFoundError(`Candidate "${candidateId}" not in ticket "${this.data.id}"`)
    }
    return match.proposedOperations
  }

  /**
   * Append a candidate to a pending ticket.
   * Used when the reviewer's actual answer doesn't match any of the skill-supplied options and they author one inline.
   * Refuses on non-pending tickets so an already-answered ticket can't grow new options retroactively,
   * and rejects duplicate ids to keep `resolveCandidate` deterministic.
   */
  appendCandidate(candidate: ClarificationCandidate): Clarification {
    this.requireStatus('pending')
    if (this.data.candidates.some(existingCandidate => existingCandidate.id === candidate.id)) {
      throw new ConflictError(
        `Candidate "${candidate.id}" already exists on ticket "${this.data.id}"`,
      )
    }
    return new Clarification({
      ...this.data,
      candidates: [...this.data.candidates, candidate],
    })
  }

  markAnswered(candidateId: ClarificationCandidateId, userId: UserId): Clarification {
    this.requireStatus('pending')
    const operations = this.resolveCandidate(candidateId)
    return new Clarification({
      ...this.data,
      status: 'answered',
      selectedCandidateId: candidateId,
      answeredBy: userId,
      resolution: [...operations],
    })
  }

  markApplied(proposalId?: ProposalId): Clarification {
    this.requireStatus('answered')
    return new Clarification({
      ...this.data,
      status: 'applied',
      ...(proposalId ? { proposalId } : {}),
    })
  }

  markSkipped(userId: UserId): Clarification {
    this.requireStatus('pending')
    return new Clarification({
      ...this.data,
      status: 'skipped',
      answeredBy: userId,
    })
  }

  toData(): ClarificationData {
    return this.data
  }

  private requireStatus(expectedStatus: ClarificationStatus): void {
    if (this.data.status !== expectedStatus) {
      throw new ConflictError(`Clarification ticket "${this.data.id}" is ${this.data.status}, not ${expectedStatus}`)
    }
  }
}
