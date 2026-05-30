import type {
  ClarifyCandidate,
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
} from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { ClarifyTicketRepository } from '../domain/hitl/ClarifyTicketRepository.js'
import type { DecisionRepository } from '../domain/hitl/DecisionRepository.js'
import type { ProposalRepository } from '../domain/hitl/ProposalRepository.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { ValidationService } from './ValidationService.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { ValidationError } from '../domain/errors.js'
import { ClarifyTicket } from '../domain/hitl/ClarifyTicket.js'
import { Proposal } from '../domain/hitl/Proposal.js'
import { newClarifyCandidateId, newClarifyTicketId, newDecisionId, newProposalId } from '../domain/ids.js'
import { PerWorkspaceLock } from './PerWorkspaceLock.js'

export interface HITLServiceDeps {
  proposalRepository: ProposalRepository
  clarifyRepository: ClarifyTicketRepository
  decisionRepository: DecisionRepository
  modelRepository: ModelRepository
  validationService: ValidationService
  workspaceService: WorkspaceService
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
  // Per-workspace lock serialises the load → validate → write → save
  // chain so two concurrent applyProposal calls on the same workspace
  // can't both pass validation against the same pre-write snapshot.
  private readonly workspaceLock = new PerWorkspaceLock()

  constructor(private readonly deps: HITLServiceDeps) {}

  // Server-side proposal creation. Validates ops against the current graph,
  // mints id + generatedAt, persists. Returns the saved Proposal so the
  // caller (HTTP route) can hand the id back to the skill.
  async submitProposal(draft: ProposalDraft): Promise<Proposal> {
    await this.assertOperationsValid(draft.workspaceId, draft.operations)
    const generatedAt = this.deps.clock.now()
    const proposal = new Proposal({
      id: newProposalId(generatedAt),
      workspaceId: draft.workspaceId,
      status: 'pending',
      operations: draft.operations,
      generatedBy: draft.generatedBy,
      generatedAt,
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
      id: newClarifyTicketId(this.deps.clock.now()),
      workspaceId: draft.workspaceId,
      question: draft.question,
      candidates: draft.candidates,
      status: 'pending',
      ...(draft.externalReferences ? { externalReferences: draft.externalReferences } : {}),
      ...(draft.origin ? { origin: draft.origin } : {}),
      ...(draft.context ? { context: draft.context } : {}),
      ...(draft.relatedNode ? { relatedNode: draft.relatedNode } : {}),
      ...(draft.ambiguityType ? { ambiguityType: draft.ambiguityType } : {}),
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
    // Outer load discovers the workspace so the lock can key on it.
    // The post-lock load is the authoritative read — the proposal may
    // have been applied by another caller while we were queued, in
    // which case markApplied raises ConflictError (status already
    // applied) and the second caller gets a clean 409 instead of a
    // misleading "node already exists" from preview.
    const initial = await this.deps.proposalRepository.load(proposalId)
    return this.workspaceLock.run(initial.workspaceId, async () => {
      const proposal = await this.deps.proposalRepository.load(proposalId)
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
   * Validates ops against the current graph (fail loud here, not later
   * inside the skill); custom selection appends a minted candidate to
   * the ticket first so the reviewer's own option lives alongside the
   * skill-supplied ones; `note` lives only on the Decision (no ticket
   * schema growth) and is projected back via GET /clarify/:id.
   */
  async answerClarifyTicket(options: {
    clarifyTicketId: ClarifyTicketId
    selection:
      | { kind: 'existing', candidateId: ClarifyCandidateId }
      | { kind: 'custom', description: string }
    userId: UserId
    note?: string
  }): Promise<Decision> {
    const { clarifyTicketId, selection, userId, note } = options
    let ticket = await this.deps.clarifyRepository.load(clarifyTicketId)
    let candidateId: ClarifyCandidateId
    if (selection.kind === 'existing') {
      candidateId = selection.candidateId
    }
    else {
      const newCandidate: ClarifyCandidate = {
        id: newClarifyCandidateId(),
        description: selection.description,
        sourceReferences: [],
        proposedOperations: [],
      }
      ticket = ticket.appendCandidate(newCandidate)
      candidateId = newCandidate.id
    }
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
      ...(note ? { rationale: note } : {}),
      references: { clarifyTicketId },
    })
  }

  /**
   * Close the loop after the braid-clarify skill has finished a ticket.
   * Ticket moves `answered → applied`. If the resolution produced a
   * Proposal, its id is stamped so the UI can link back; if the chosen
   * candidate had no graph impact, proposalId is omitted. No graph
   * mutation here — the Proposal apply path (when there is one) already
   * handled that.
   */
  async markClarifyTicketApplied(
    clarifyTicketId: ClarifyTicketId,
    userId: UserId,
    proposalId?: ProposalId,
  ): Promise<Decision> {
    const ticket = await this.deps.clarifyRepository.load(clarifyTicketId)
    const applied = ticket.markApplied(proposalId)
    await this.deps.clarifyRepository.save(applied)
    this.deps.eventBus?.publish({
      type: 'clarify.applied',
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      ...(proposalId ? { proposalId } : {}),
      at: this.deps.clock.now(),
    })

    return this.recordDecision({
      workspaceId: ticket.workspaceId,
      action: 'applyClarifyTicket',
      by: userId,
      references: { clarifyTicketId, ...(proposalId ? { proposalId } : {}) },
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
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const snapshot = await this.deps.modelRepository.load(workspaceId)
    const result = await this.deps.validationService.validateOperations(snapshot, operations, workspace)
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
