import type {
  ExternalReference,
  GraphOperation,
  ModelSnapshot,
  Proposal as ProposalData,
  ProposalId,
  ProposalStatus,
  SkillId,
  Timestamp,
  UserId,
} from '@telos/schema'
import type { Model } from '../model/Model.js'

export class Proposal {
  constructor(private readonly data: ProposalData) {}

  get id(): ProposalId { return this.data.id }
  get status(): ProposalStatus { return this.data.status }
  get operations(): GraphOperation[] { return this.data.operations }
  get generatedBy(): SkillId { return this.data.generatedBy }
  get generatedAt(): Timestamp { return this.data.generatedAt }
  get rationale(): string { return this.data.rationale }
  get reviewedBy(): UserId | undefined { return this.data.reviewedBy }
  get externalReferences(): ExternalReference[] | undefined { return this.data.externalReferences }

  apply(model: Model): ModelSnapshot {
    model.applyOperations(this.data.operations)
    return model.toSnapshot()
  }

  toData(): ProposalData {
    return this.data
  }
}
