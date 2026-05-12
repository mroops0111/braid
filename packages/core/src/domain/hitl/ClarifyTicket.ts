import type {
  ClarifyCandidate,
  ClarifyCandidateId,
  ClarifyStatus,
  ClarifyTicket as ClarifyTicketData,
  ClarifyTicketId,
  ExternalReference,
  GraphOperation,
  UserId,
  WorkspaceId,
} from '@telos/schema'
import { ConflictError, NotFoundError } from '../errors.js'

export class ClarifyTicket {
  constructor(private readonly data: ClarifyTicketData) {}

  get id(): ClarifyTicketId { return this.data.id }
  get workspaceId(): WorkspaceId { return this.data.workspaceId }
  get question(): string { return this.data.question }
  get candidates(): readonly ClarifyCandidate[] { return this.data.candidates }
  get status(): ClarifyStatus { return this.data.status }
  get selectedCandidateId(): ClarifyCandidateId | undefined { return this.data.selectedCandidateId }
  get externalReferences(): readonly ExternalReference[] | undefined { return this.data.externalReferences }

  resolveCandidate(candidateId: ClarifyCandidateId): readonly GraphOperation[] {
    const candidate = this.data.candidates.find(entry => entry.id === candidateId)
    if (!candidate) {
      throw new NotFoundError(`Candidate "${candidateId}" not in ticket "${this.data.id}"`)
    }
    return candidate.proposedOperations
  }

  markApplied(candidateId: ClarifyCandidateId, userId: UserId): ClarifyTicket {
    this.requirePending('answer')
    const operations = this.resolveCandidate(candidateId)
    return new ClarifyTicket({
      ...this.data,
      status: 'applied',
      selectedCandidateId: candidateId,
      answeredBy: userId,
      resolution: [...operations],
    })
  }

  markSkipped(userId: UserId): ClarifyTicket {
    this.requirePending('skip')
    return new ClarifyTicket({
      ...this.data,
      status: 'skipped',
      answeredBy: userId,
    })
  }

  toData(): ClarifyTicketData {
    return this.data
  }

  private requirePending(action: string): void {
    if (this.data.status !== 'pending') {
      throw new ConflictError(
        `Cannot ${action} clarify ticket "${this.data.id}": current status is "${this.data.status}", expected "pending"`,
      )
    }
  }
}
