import type {
  ClarifyCandidate,
  ClarifyCandidateId,
  ClarifyDraft,
  ClarifyTicketId,
  CommitMessage,
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
import type { WorkspaceHistory } from '../domain/history/WorkspaceHistory.js'
import type { ClarifyTicketRepository } from '../domain/hitl/ClarifyTicketRepository.js'
import type { DecisionRepository } from '../domain/hitl/DecisionRepository.js'
import type { ProposalRepository } from '../domain/hitl/ProposalRepository.js'
import type { GraphSerializer } from '../domain/model/GraphSerializer.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { UserDirectory } from '../domain/users/UserDirectory.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { ValidationService } from './ValidationService.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { ValidationError } from '../domain/errors.js'
import { ClarifyTicket } from '../domain/hitl/ClarifyTicket.js'
import { Proposal } from '../domain/hitl/Proposal.js'
import { newClarifyCandidateId, newClarifyTicketId, newDecisionId, newProposalId } from '../domain/ids.js'
import { noopUserDirectory } from '../domain/users/UserDirectory.js'
import { PerWorkspaceLock } from './PerWorkspaceLock.js'

// Generic system author for submit commits until Theme 13 (account management) supplies real per-user attribution.
const SUBMIT_USER_ID = 'braid-skill' as UserId

export interface HITLServiceDeps {
  proposalRepository: ProposalRepository
  clarifyRepository: ClarifyTicketRepository
  decisionRepository: DecisionRepository
  modelRepository: ModelRepository
  validationService: ValidationService
  workspaceService: WorkspaceService
  clock: Clock
  eventBus?: WorkspaceEventBus
  // Both required together; absence makes the commit hook a no-op.
  history?: WorkspaceHistory
  graphSerializer?: GraphSerializer
  // Inject so HistoryService.restore can share the same exclusion domain.
  workspaceLock?: PerWorkspaceLock
  /**
   * Looks up displayName + email to snapshot into git author at commit
   * time. Defaults to `noopUserDirectory` (no rewrite) so existing
   * tests keep their `Author: <userId>` shape.
   */
  userDirectory?: UserDirectory
}

export class HITLService {
  // Serialises mutation + commit on the same workspace.
  private readonly workspaceLock: PerWorkspaceLock
  private readonly userDirectory: UserDirectory

  constructor(private readonly deps: HITLServiceDeps) {
    this.workspaceLock = deps.workspaceLock ?? new PerWorkspaceLock()
    this.userDirectory = deps.userDirectory ?? noopUserDirectory
  }

  async submitProposal(draft: ProposalDraft & { submitterId?: UserId }): Promise<Proposal> {
    await this.assertOperationsValid(draft.workspaceId, draft.operations)
    const generatedAt = this.deps.clock.now()
    const owner = draft.submitterId ? await this.userDirectory.resolve(draft.submitterId) : null
    const proposal = new Proposal({
      id: newProposalId(generatedAt),
      workspaceId: draft.workspaceId,
      status: 'pending',
      operations: draft.operations,
      generatedBy: draft.generatedBy,
      generatedAt,
      rationale: draft.rationale,
      ...(draft.externalReferences ? { externalReferences: draft.externalReferences } : {}),
      ...(draft.submitterId ? { ownerId: draft.submitterId } : {}),
      ...(owner?.displayName ? { ownerDisplayName: owner.displayName } : {}),
    })
    return this.workspaceLock.run(draft.workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(draft.workspaceId)
      await this.deps.proposalRepository.save(proposal)
      // Submit commits so collaborators see the artefact via `git pull`. Attribution stays generic until Theme 13.
      await this.commitWorkspaceChange(workspace, {
        kind: 'proposal-submit',
        subject: `submitted ${proposal.id}`,
        userId: SUBMIT_USER_ID,
        proposalId: proposal.id,
      })
      this.deps.eventBus?.publish({
        type: 'proposal.created',
        workspaceId: proposal.workspaceId,
        proposalId: proposal.id,
        at: this.deps.clock.now(),
      })
      return proposal
    })
  }

  // Candidates are only validated at answer time, since each picks a different op set.
  async submitClarifyTicket(draft: ClarifyDraft & { submitterId?: UserId }): Promise<ClarifyTicket> {
    const owner = draft.submitterId ? await this.userDirectory.resolve(draft.submitterId) : null
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
      ...(draft.submitterId ? { ownerId: draft.submitterId } : {}),
      ...(owner?.displayName ? { ownerDisplayName: owner.displayName } : {}),
    })
    return this.workspaceLock.run(draft.workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(draft.workspaceId)
      await this.deps.clarifyRepository.save(ticket)
      await this.commitWorkspaceChange(workspace, {
        kind: 'clarify-submit',
        subject: `submitted ${ticket.id}`,
        userId: SUBMIT_USER_ID,
        clarifyTicketId: ticket.id,
      })
      this.deps.eventBus?.publish({
        type: 'clarify.created',
        workspaceId: ticket.workspaceId,
        ticketId: ticket.id,
        at: this.deps.clock.now(),
      })
      return ticket
    })
  }

  async applyProposal(proposalId: ProposalId, userId: UserId): Promise<Decision> {
    // Outer load discovers the workspace for the lock key; the inner load is the authoritative read post-lock.
    const initial = await this.deps.proposalRepository.load(proposalId)
    return this.workspaceLock.run(initial.workspaceId, async () => {
      const proposal = await this.deps.proposalRepository.load(proposalId)
      const workspace = await this.deps.workspaceService.findById(proposal.workspaceId)
      const applied = proposal.markApplied(userId, this.deps.clock.now())
      await this.assertOperationsValid(proposal.workspaceId, [...proposal.operations])
      await this.deps.modelRepository.applyOperations(proposal.workspaceId, [...proposal.operations])
      await this.deps.proposalRepository.save(applied)
      await this.commitWorkspaceChange(
        workspace,
        { kind: 'proposal-apply', subject: `applied ${proposalId}`, userId, proposalId },
        { syncGraph: true },
      )
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
    return this.workspaceLock.run(proposal.workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(proposal.workspaceId)
      const rejected = proposal.markRejected(userId, this.deps.clock.now())
      await this.deps.proposalRepository.save(rejected)
      await this.commitWorkspaceChange(workspace, {
        kind: 'proposal-reject',
        subject: `rejected ${proposalId}`,
        userId,
        proposalId,
      })
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
    })
  }

  // `note` lives on the Decision (no ticket-schema growth) and is projected back via GET /clarify/:id.
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

    return this.workspaceLock.run(ticket.workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(ticket.workspaceId)
      const answered = ticket.markAnswered(candidateId, userId)
      await this.deps.clarifyRepository.save(answered)
      await this.commitWorkspaceChange(workspace, {
        kind: 'clarify-answer',
        subject: `answered ${clarifyTicketId}`,
        userId,
        clarifyTicketId,
      })
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
    })
  }

  // No graph mutation here — the Proposal apply path (when there is one) handled that.
  async markClarifyTicketApplied(
    clarifyTicketId: ClarifyTicketId,
    userId: UserId,
    proposalId?: ProposalId,
  ): Promise<Decision> {
    const ticket = await this.deps.clarifyRepository.load(clarifyTicketId)
    return this.workspaceLock.run(ticket.workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(ticket.workspaceId)
      const applied = ticket.markApplied(proposalId)
      await this.deps.clarifyRepository.save(applied)
      await this.commitWorkspaceChange(workspace, {
        kind: 'clarify-apply',
        subject: `closed ${clarifyTicketId}`,
        userId,
        clarifyTicketId,
        ...(proposalId ? { proposalId } : {}),
      })
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
    })
  }

  async skipClarifyTicket(
    clarifyTicketId: ClarifyTicketId,
    reason: string,
    userId: UserId,
  ): Promise<Decision> {
    const ticket = await this.deps.clarifyRepository.load(clarifyTicketId)
    return this.workspaceLock.run(ticket.workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(ticket.workspaceId)
      const skipped = ticket.markSkipped(userId)
      await this.deps.clarifyRepository.save(skipped)
      await this.commitWorkspaceChange(workspace, {
        kind: 'clarify-skip',
        subject: `skipped ${clarifyTicketId}`,
        userId,
        clarifyTicketId,
      })
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

  // Caller must hold the per-workspace lock. No-op when history/serializer deps weren't wired.
  private async commitWorkspaceChange(
    workspace: Workspace,
    message: CommitMessage,
    options: { syncGraph: boolean } = { syncGraph: false },
  ): Promise<void> {
    if (!this.deps.history || !this.deps.graphSerializer)
      return
    if (options.syncGraph) {
      const snapshot = await this.deps.modelRepository.load(workspace.id)
      await this.deps.graphSerializer.write(workspace, snapshot)
    }
    const enriched = await this.enrichAuthor(message)
    const sha = await this.deps.history.commit(workspace, enriched)
    this.deps.eventBus?.publish({
      type: 'history.committed',
      workspaceId: workspace.id,
      sha,
      at: this.deps.clock.now(),
    })
  }

  /**
   * Snapshot the user's displayName + email into the commit so git
   * stores the real Google identity. Skips when `userDirectory`
   * doesn't know the userId — bootstrap / skill-system authors lack
   * a row and fall through to the placeholder synth in the git layer.
   */
  private async enrichAuthor(message: CommitMessage): Promise<CommitMessage> {
    if (message.authorName !== undefined || message.authorEmail !== undefined)
      return message
    const author = await this.userDirectory.resolve(message.userId)
    if (!author)
      return message
    return {
      ...message,
      authorName: author.displayName,
      ...(author.email ? { authorEmail: author.email } : {}),
    }
  }
}
