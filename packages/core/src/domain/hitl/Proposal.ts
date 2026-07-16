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

  // Returns a new Proposal in 'applied' state. Caller must persist the new instance and run the operations,
  // we keep the entity pure with no side effects.
  markApplied(userId: UserId, reviewedAt: Timestamp): Proposal {
    this.requireStatus('pending')
    return new Proposal({
      ...this.data,
      status: 'applied',
      reviewedBy: userId,
      reviewedAt,
    })
  }

  markRejected(userId: UserId, reviewedAt: Timestamp): Proposal {
    this.requireStatus('pending')
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

  private requireStatus(expectedStatus: ProposalStatus): void {
    if (this.data.status !== expectedStatus) {
      throw new ConflictError(`Proposal "${this.data.id}" is ${this.data.status}, not ${expectedStatus}`)
    }
  }
}
