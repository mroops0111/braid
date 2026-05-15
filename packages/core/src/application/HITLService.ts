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
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
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
  /**
   * Optional pub/sub. Injected at the composition root so Studio's
   * `useWorkspaceEvents` SSE invalidates its react-query caches the
   * moment a proposal / clarify-ticket changes. Tests without a bus pass
   * undefined and skip the notifications.
   */
  eventBus?: WorkspaceEventBus
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
    this.deps.eventBus?.publish({
      type: 'proposal.created',
      workspaceId: proposal.workspaceId,
      proposalId: proposal.id,
      at: this.deps.clock.now(),
    })
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
    this.deps.eventBus?.publish({
      type: 'clarify.created',
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      at: this.deps.clock.now(),
    })
    return ticket
  }

  async applyProposal(proposalId: ProposalId, userId: UserId): Promise<Decision> {
    const proposal = await this.deps.proposalRepository.load(proposalId)
    // Check the status transition first so a re-apply of an already-applied
    // proposal raises ConflictError instead of whatever validation issue its
    // ops would now produce against the post-first-apply graph.
    const applied = proposal.markApplied(userId, this.deps.clock.now())
    await this.assertOperationsValid(proposal.workspaceId, [...proposal.operations])
    await this.deps.modelRepository.applyOperations(proposal.workspaceId, [...proposal.operations])
    await this.deps.proposalRepository.save(applied)
    this.deps.eventBus?.publish({
      type: 'proposal.applied',
      workspaceId: proposal.workspaceId,
      proposalId: proposal.id,
      at: this.deps.clock.now(),
    })

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
    this.deps.eventBus?.publish({
      type: 'proposal.rejected',
      workspaceId: proposal.workspaceId,
      proposalId: proposal.id,
      at: this.deps.clock.now(),
    })

    return this.recordDecision({
      workspaceId: proposal.workspaceId,
      action: 'rejectProposal',
      by: userId,
      rationale: reason,
      references: { proposalId },
    })
  }

  /**
   * Record the user's chosen candidate. Validates the resolution
   * operations against the current graph so we fail loudly here rather
   * than later when the telos-clarify skill tries to build a Proposal,
   * but does **not** apply them — that's the Proposal review's job.
   * Ticket moves `pending → answered`; resolution + selectedCandidateId
   * are stamped onto it.
   */
  async answerClarifyTicket(
    clarifyTicketId: ClarifyTicketId,
    candidateId: ClarifyCandidateId,
    userId: UserId,
  ): Promise<Decision> {
    const ticket = await this.deps.clarifyRepository.load(clarifyTicketId)
    const operations = [...ticket.resolveCandidate(candidateId)]
    await this.assertOperationsValid(ticket.workspaceId, operations)

    const answered = ticket.markAnswered(candidateId, userId)
    await this.deps.clarifyRepository.save(answered)
    this.deps.eventBus?.publish({
      type: 'clarify.answered',
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      at: this.deps.clock.now(),
    })

    return this.recordDecision({
      workspaceId: ticket.workspaceId,
      action: 'answerClarifyTicket',
      by: userId,
      references: { clarifyTicketId },
    })
  }

  /**
   * Close the loop after the telos-clarify skill has materialised an
   * `answered` ticket's resolution into a Proposal. Ticket moves
   * `answered → applied` and stamps the linking proposalId. No graph
   * mutation here — the Proposal apply path already handled that.
   */
  async linkClarifyTicketToProposal(
    clarifyTicketId: ClarifyTicketId,
    proposalId: ProposalId,
    userId: UserId,
  ): Promise<Decision> {
    const ticket = await this.deps.clarifyRepository.load(clarifyTicketId)
    const applied = ticket.markAppliedWithProposal(proposalId)
    await this.deps.clarifyRepository.save(applied)
    this.deps.eventBus?.publish({
      type: 'clarify.applied',
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      proposalId,
      at: this.deps.clock.now(),
    })

    return this.recordDecision({
      workspaceId: ticket.workspaceId,
      action: 'applyClarifyTicket',
      by: userId,
      references: { clarifyTicketId, proposalId },
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
    this.deps.eventBus?.publish({
      type: 'clarify.skipped',
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      at: this.deps.clock.now(),
    })

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
