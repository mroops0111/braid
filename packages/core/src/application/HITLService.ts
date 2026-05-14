import type {
  ClarifyCandidateId,
  ClarifyDraft,
  ClarifyTicketId,
  Decision,
  DecisionAction,
  DecisionReferences,
  GraphOperation,
  ProposalDraft,
  ProposalId,
  UserId,
  ValidationIssue,
  WorkspaceId,
} from '@telos/schema'
import type { Clock } from '../domain/Clock.js'
import type { ClarifyTicketRepository } from '../domain/hitl/ClarifyTicketRepository.js'
import type { DecisionRepository } from '../domain/hitl/DecisionRepository.js'
import type { ProposalRepository } from '../domain/hitl/ProposalRepository.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { ValidationService } from './ValidationService.js'
import { ValidationError } from '../domain/errors.js'
import { ClarifyTicket } from '../domain/hitl/ClarifyTicket.js'
import { Proposal } from '../domain/hitl/Proposal.js'
import { newClarifyTicketId, newDecisionId, newProposalId } from '../domain/ids.js'

export interface HITLServiceDeps {
  proposalRepository: ProposalRepository
  clarifyRepository: ClarifyTicketRepository
  decisionRepository: DecisionRepository
  modelRepository: ModelRepository
  validationService: ValidationService
  clock: Clock
}

export class HITLService {
  constructor(private readonly deps: HITLServiceDeps) {}

  // Server-side proposal creation. Validates ops against the current graph,
  // mints id + generatedAt, persists. Returns the saved Proposal so the
  // caller (HTTP route) can hand the id back to the skill.
  async submitProposal(draft: ProposalDraft): Promise<Proposal> {
    await this.assertOperationsValid(draft.workspaceId, draft.operations)
    const proposal = new Proposal({
      id: newProposalId(),
      workspaceId: draft.workspaceId,
      status: 'pending',
      operations: draft.operations,
      generatedBy: draft.generatedBy,
      generatedAt: this.deps.clock.now(),
      rationale: draft.rationale,
      ...(draft.externalReferences ? { externalReferences: draft.externalReferences } : {}),
    })
    await this.deps.proposalRepository.save(proposal)
    return proposal
  }

  // Server-side clarify ticket creation. No graph validation: clarify
  // ticket candidates' proposedOperations are only validated when the user
  // selects one via answerClarifyTicket.
  async submitClarifyTicket(draft: ClarifyDraft): Promise<ClarifyTicket> {
    const ticket = new ClarifyTicket({
      id: newClarifyTicketId(),
      workspaceId: draft.workspaceId,
      question: draft.question,
      candidates: draft.candidates,
      status: 'pending',
      ...(draft.externalReferences ? { externalReferences: draft.externalReferences } : {}),
    })
    await this.deps.clarifyRepository.save(ticket)
    return ticket
  }

  async applyProposal(proposalId: ProposalId, userId: UserId): Promise<Decision> {
    const proposal = await this.deps.proposalRepository.load(proposalId)
    await this.assertOperationsValid(proposal.workspaceId, [...proposal.operations])

    const applied = proposal.markApplied(userId, this.deps.clock.now())
    await this.deps.modelRepository.applyOperations(proposal.workspaceId, [...proposal.operations])
    await this.deps.proposalRepository.save(applied)

    return this.recordDecision({
      workspaceId: proposal.workspaceId,
      action: 'applyProposal',
      by: userId,
      references: { proposalId },
    })
  }

  async rejectProposal(proposalId: ProposalId, reason: string, userId: UserId): Promise<Decision> {
    const proposal = await this.deps.proposalRepository.load(proposalId)
    const rejected = proposal.markRejected(userId, this.deps.clock.now())
    await this.deps.proposalRepository.save(rejected)

    return this.recordDecision({
      workspaceId: proposal.workspaceId,
      action: 'rejectProposal',
      by: userId,
      rationale: reason,
      references: { proposalId },
    })
  }

  async answerClarifyTicket(
    clarifyTicketId: ClarifyTicketId,
    candidateId: ClarifyCandidateId,
    userId: UserId,
  ): Promise<Decision> {
    const ticket = await this.deps.clarifyRepository.load(clarifyTicketId)
    const operations = [...ticket.resolveCandidate(candidateId)]
    await this.assertOperationsValid(ticket.workspaceId, operations)

    const applied = ticket.markApplied(candidateId, userId)
    await this.deps.modelRepository.applyOperations(ticket.workspaceId, operations)
    await this.deps.clarifyRepository.save(applied)

    return this.recordDecision({
      workspaceId: ticket.workspaceId,
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
    const skipped = ticket.markSkipped(userId)
    await this.deps.clarifyRepository.save(skipped)

    return this.recordDecision({
      workspaceId: ticket.workspaceId,
      action: 'skipClarifyTicket',
      by: userId,
      rationale: reason,
      references: { clarifyTicketId },
    })
  }

  private async assertOperationsValid(
    workspaceId: WorkspaceId,
    operations: readonly GraphOperation[],
  ): Promise<void> {
    const snapshot = await this.deps.modelRepository.load(workspaceId)
    const result = await this.deps.validationService.validateOperations(snapshot, operations)
    if (!result.ok) {
      throw new ValidationError(this.formatValidationErrors(result.issues), result.issues)
    }
  }

  private formatValidationErrors(issues: readonly ValidationIssue[]): string {
    const errors = issues.filter(issue => issue.severity === 'error')
    if (errors.length === 0)
      return 'Validation failed'
    return errors.map(issue => `[${issue.code}] ${issue.message}`).join('; ')
  }

  private async recordDecision(input: {
    workspaceId: WorkspaceId
    action: DecisionAction
    by: UserId | 'system'
    rationale?: string
    references: DecisionReferences
  }): Promise<Decision> {
    const decision: Decision = {
      id: newDecisionId(),
      timestamp: this.deps.clock.now(),
      ...input,
    }
    await this.deps.decisionRepository.append(decision)
    return decision
  }
}
