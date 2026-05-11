import type {
  ClarifyCandidate,
  ClarifyCandidateId,
  ClarifyStatus,
  ClarifyTicket as ClarifyTicketData,
  ClarifyTicketId,
  ExternalReference,
  GraphOperation,
} from '@telos/schema'
import { NotFoundError } from '../errors.js'

export class ClarifyTicket {
  constructor(private readonly data: ClarifyTicketData) {}

  get id(): ClarifyTicketId { return this.data.id }
  get question(): string { return this.data.question }
  get candidates(): ClarifyCandidate[] { return this.data.candidates }
  get status(): ClarifyStatus { return this.data.status }
  get selectedCandidateId(): ClarifyCandidateId | undefined { return this.data.selectedCandidateId }
  get externalReferences(): ExternalReference[] | undefined { return this.data.externalReferences }

  selectCandidate(candidateId: ClarifyCandidateId): GraphOperation[] {
    const candidate = this.data.candidates.find(entry => entry.id === candidateId)
    if (!candidate) {
      throw new NotFoundError(`Candidate "${candidateId}" not in ticket "${this.data.id}"`)
    }
    return candidate.proposedOperations
  }

  toData(): ClarifyTicketData {
    return this.data
  }
}
