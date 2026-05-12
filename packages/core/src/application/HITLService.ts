import type {
  ClarifyCandidateId,
  ClarifyTicketId,
  Decision,
  DecisionAction,
  DecisionReferences,
  GraphOperation,
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
import { newDecisionId } from '../domain/ids.js'

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
      throw new ValidationError(this.formatValidationErrors(result.issues))
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
