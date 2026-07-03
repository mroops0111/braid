import type {
  Actor,
  ClarifyCandidate,
  ClarifyCandidateId,
  ClarifyStatus,
  ClarifyTicket as ClarifyTicketData,
  ClarifyTicketId,
  ExternalReference,
  GraphOperation,
  ProposalId,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import { ConflictError, NotFoundError } from '../errors.js'

/**
 * Lifecycle:
 *   pending  → answered → applied
 *           ↘ skipped
 *
 * `markAnswered` records the user's choice but does NOT mutate the
 * graph; the resolution is snapshotted onto the ticket and the
 * braid-clarify skill is expected to wrap it into a Proposal. Once
 * that Proposal lands the ticket transitions to `applied` via
 * `markApplied`, which only stamps the (optional) proposalId — the
 * actual graph mutation happens inside `HITLService.applyProposal`.
 * proposalId is omitted when the chosen candidate's resolution had no
 * graph impact, so no Proposal was produced.
 *
 * Keeping these two transitions distinct preserves the invariant
 * "only HITLService.applyProposal writes Kùzu": clarify answers go
 * through the same review gate as any other agent output.
 */
export class ClarifyTicket {
  constructor(private readonly data: ClarifyTicketData) {}

  get id(): ClarifyTicketId { return this.data.id }
  get workspaceId(): WorkspaceId { return this.data.workspaceId }
  get question(): string { return this.data.question }
  get candidates(): readonly ClarifyCandidate[] { return this.data.candidates }
  get status(): ClarifyStatus { return this.data.status }
  get selectedCandidateId(): ClarifyCandidateId | undefined { return this.data.selectedCandidateId }
  get resolution(): readonly GraphOperation[] | undefined { return this.data.resolution }
  get proposalId(): ProposalId | undefined { return this.data.proposalId }
  get owner(): Actor { return this.data.owner }
  get ownerDisplayName(): string | undefined { return this.data.ownerDisplayName }
  get externalReferences(): readonly ExternalReference[] | undefined { return this.data.externalReferences }

  resolveCandidate(candidateId: ClarifyCandidateId): readonly GraphOperation[] {
    const candidate = this.data.candidates.find(entry => entry.id === candidateId)
    if (!candidate) {
      throw new NotFoundError(`Candidate "${candidateId}" not in ticket "${this.data.id}"`)
    }
    return candidate.proposedOperations
  }

  /**
   * Append a candidate to a pending ticket. Used when the reviewer's
   * actual answer doesn't match any of the skill-supplied options and
   * they author one inline. Refuses on non-pending tickets so an
   * already-answered ticket can't grow new options retroactively, and
   * rejects duplicate ids to keep `resolveCandidate` deterministic.
   */
  appendCandidate(candidate: ClarifyCandidate): ClarifyTicket {
    this.requireStatus('append candidate', 'pending')
    if (this.data.candidates.some(existing => existing.id === candidate.id)) {
      throw new ConflictError(
        `Candidate "${candidate.id}" already exists on ticket "${this.data.id}"`,
      )
    }
    return new ClarifyTicket({
      ...this.data,
      candidates: [...this.data.candidates, candidate],
    })
  }

  markAnswered(candidateId: ClarifyCandidateId, userId: UserId): ClarifyTicket {
    this.requireStatus('answer', 'pending')
    const operations = this.resolveCandidate(candidateId)
    return new ClarifyTicket({
      ...this.data,
      status: 'answered',
      selectedCandidateId: candidateId,
      answeredBy: userId,
      resolution: [...operations],
    })
  }

  markApplied(proposalId?: ProposalId): ClarifyTicket {
    this.requireStatus('apply', 'answered')
    return new ClarifyTicket({
      ...this.data,
      status: 'applied',
      ...(proposalId ? { proposalId } : {}),
    })
  }

  markSkipped(userId: UserId): ClarifyTicket {
    this.requireStatus('skip', 'pending')
    return new ClarifyTicket({
      ...this.data,
      status: 'skipped',
      answeredBy: userId,
    })
  }

  toData(): ClarifyTicketData {
    return this.data
  }

  private requireStatus(action: string, expected: ClarifyStatus): void {
    if (this.data.status !== expected) {
      throw new ConflictError(
        `Cannot ${action} clarify ticket "${this.data.id}": current status is "${this.data.status}", expected "${expected}"`,
      )
    }
  }
}
