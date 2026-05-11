import type {
  ClarifyCandidateId,
  ClarifyTicketId,
  Decision,
  DecisionId,
  ProposalId,
  Timestamp,
  UserId,
  WorkspaceId,
} from '@telos/schema'
import type { ClarifyTicketRepository } from '../domain/hitl/ClarifyTicketRepository.js'
import type { DecisionRepository } from '../domain/hitl/DecisionRepository.js'
import type { ProposalRepository } from '../domain/hitl/ProposalRepository.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import { ClarifyTicket } from '../domain/hitl/ClarifyTicket.js'
import { Proposal } from '../domain/hitl/Proposal.js'

export interface HITLServiceDeps {
  proposalRepository: ProposalRepository
  clarifyRepository: ClarifyTicketRepository
  decisionRepository: DecisionRepository
  modelRepository: ModelRepository
}

export class HITLService {
  constructor(private readonly deps: HITLServiceDeps) {}

  async applyProposal(
    proposalId: ProposalId,
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<Decision> {
    const proposal = await this.deps.proposalRepository.load(proposalId)
    await this.deps.modelRepository.applyOperations(workspaceId, proposal.operations)

    const updated = new Proposal({
      ...proposal.toData(),
      status: 'applied',
      reviewedBy: userId,
      reviewedAt: this.now(),
    })
    await this.deps.proposalRepository.save(updated)

    return this.recordDecision({
      action: 'applyProposal',
      by: userId,
      references: { proposalId },
    })
  }

  async rejectProposal(
    proposalId: ProposalId,
    reason: string,
    userId: UserId,
  ): Promise<Decision> {
    const proposal = await this.deps.proposalRepository.load(proposalId)
    const updated = new Proposal({
      ...proposal.toData(),
      status: 'rejected',
      reviewedBy: userId,
      reviewedAt: this.now(),
    })
    await this.deps.proposalRepository.save(updated)

    return this.recordDecision({
      action: 'rejectProposal',
      by: userId,
      rationale: reason,
      references: { proposalId },
    })
  }

  async answerClarifyTicket(
    clarifyTicketId: ClarifyTicketId,
    candidateId: ClarifyCandidateId,
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<Decision> {
    const ticket = await this.deps.clarifyRepository.load(clarifyTicketId)
    const operations = ticket.selectCandidate(candidateId)
    await this.deps.modelRepository.applyOperations(workspaceId, operations)

    const updated = new ClarifyTicket({
      ...ticket.toData(),
      status: 'applied',
      selectedCandidateId: candidateId,
      answeredBy: userId,
      resolution: operations,
    })
    await this.deps.clarifyRepository.save(updated)

    return this.recordDecision({
      action: 'answerClarifyTicket',
      by: userId,
      references: { clarifyTicketId },
    })
  }

  async skipClarifyTicket(
    clarifyTicketId: ClarifyTicketId,
    reason: string,
    userId: UserId,
  ): Promise<Decision> {
    const ticket = await this.deps.clarifyRepository.load(clarifyTicketId)
    const updated = new ClarifyTicket({
      ...ticket.toData(),
      status: 'skipped',
      answeredBy: userId,
    })
    await this.deps.clarifyRepository.save(updated)

    return this.recordDecision({
      action: 'skipClarifyTicket',
      by: userId,
      rationale: reason,
      references: { clarifyTicketId },
    })
  }

  private async recordDecision(
    partial: Omit<Decision, 'id' | 'timestamp'>,
  ): Promise<Decision> {
    const decision: Decision = {
      id: crypto.randomUUID() as DecisionId,
      timestamp: this.now(),
      ...partial,
    }
    await this.deps.decisionRepository.append(decision)
    return decision
  }

  private now(): Timestamp {
    return new Date().toISOString() as Timestamp
  }
}
