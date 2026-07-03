import type {
  Actor,
  ExternalReference,
  GraphOperation,
  Proposal as ProposalData,
  ProposalId,
  ProposalStatus,
  SkillId,
  Timestamp,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import { ConflictError } from '../errors.js'

export class Proposal {
  constructor(private readonly data: ProposalData) {}

  get id(): ProposalId { return this.data.id }
  get workspaceId(): WorkspaceId { return this.data.workspaceId }
  get status(): ProposalStatus { return this.data.status }
  get operations(): readonly GraphOperation[] { return this.data.operations }
  get generatedBy(): SkillId { return this.data.generatedBy }
  get generatedAt(): Timestamp { return this.data.generatedAt }
  get rationale(): string { return this.data.rationale }
  get reviewedBy(): UserId | undefined { return this.data.reviewedBy }
  get owner(): Actor { return this.data.owner }
  get ownerDisplayName(): string | undefined { return this.data.ownerDisplayName }
  get externalReferences(): readonly ExternalReference[] | undefined { return this.data.externalReferences }

  // Returns a new Proposal in 'applied' state. Caller is responsible for
  // persisting the new instance + actually running operations against the
  // model (we keep entity pure, no side effects).
  markApplied(userId: UserId, reviewedAt: Timestamp): Proposal {
    this.requirePending('apply')
    return new Proposal({
      ...this.data,
      status: 'applied',
      reviewedBy: userId,
      reviewedAt,
    })
  }

  markRejected(userId: UserId, reviewedAt: Timestamp): Proposal {
    this.requirePending('reject')
    return new Proposal({
      ...this.data,
      status: 'rejected',
      reviewedBy: userId,
      reviewedAt,
    })
  }

  toData(): ProposalData {
    return this.data
  }

  private requirePending(action: string): void {
    if (this.data.status !== 'pending') {
      throw new ConflictError(
        `Cannot ${action} proposal "${this.data.id}": current status is "${this.data.status}", expected "pending"`,
      )
    }
  }
}
