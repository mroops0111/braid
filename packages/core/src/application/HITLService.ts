import type {
  ClarificationCandidate,
  ClarificationCandidateId,
  ClarificationCreate,
  ClarificationId,
  CommitMessage,
  GraphOperation,
  ProposalCreate,
  ProposalId,
  ValidationIssue,
  WorkspaceId,
} from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { WorkspaceHistory } from '../domain/history/WorkspaceHistory.js'
import type { ClarificationRepository } from '../domain/hitl/ClarificationRepository.js'
import type { ProposalRepository } from '../domain/hitl/ProposalRepository.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { ModelSerializer } from '../domain/model/ModelSerializer.js'
import type { UserDirectory } from '../domain/users/UserDirectory.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { ModelValidationService } from './ModelValidationService.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { UserId } from '@braidhq/schema'
import { ValidationError } from '../domain/errors.js'
import { Clarification } from '../domain/hitl/Clarification.js'
import { Proposal } from '../domain/hitl/Proposal.js'
import { newClarificationCandidateId, newClarificationId, newProposalId } from '../domain/ids.js'
import { noopUserDirectory } from '../domain/users/UserDirectory.js'
import { enrichCommitAuthor } from './enrichCommitAuthor.js'
import { WorkspaceLock } from './WorkspaceLock.js'

// Generic system author for submit commits, until account management supplies real per-user attribution.
const SUBMIT_USER_ID = UserId.parse('braid-skill')

export interface HITLServiceDeps {
  proposalRepository: ProposalRepository
  clarificationRepository: ClarificationRepository
  modelRepository: ModelRepository
  modelValidationService: ModelValidationService
  workspaceService: WorkspaceService
  clock: Clock
  eventBus?: WorkspaceEventBus
  // Both required together. Absence makes the commit hook a no-op.
  history?: WorkspaceHistory
  modelSerializer?: ModelSerializer
  // Inject so HistoryService.restore can share the same exclusion domain.
  workspaceLock?: WorkspaceLock
  /**
   * Looks up displayName + email to snapshot into git author at commit time.
   * Defaults to `noopUserDirectory` (no rewrite) so existing tests keep their `Author: <userId>` shape.
   */
  userDirectory?: UserDirectory
}

export class HITLService {
  // Serialises mutation + commit on the same workspace.
  private readonly workspaceLock: WorkspaceLock
  private readonly userDirectory: UserDirectory

  constructor(private readonly deps: HITLServiceDeps) {
    this.workspaceLock = deps.workspaceLock ?? new WorkspaceLock()
    this.userDirectory = deps.userDirectory ?? noopUserDirectory
  }

  async submitProposal(draft: ProposalCreate & { submitterId?: UserId }): Promise<Proposal> {
    await this.assertOperationsValid(draft.workspaceId, draft.operations)
    const generatedAt = this.deps.clock.now()
    const submitter = draft.submitterId ? await this.userDirectory.resolve(draft.submitterId) : null
    const proposal = new Proposal({
      id: newProposalId(),
      workspaceId: draft.workspaceId,
      status: 'pending',
      operations: draft.operations,
      generatedBy: draft.generatedBy,
      generatedAt,
      rationale: draft.rationale,
      ...(draft.externalReferences ? { externalReferences: draft.externalReferences } : {}),
      owner: draft.submitterId ?? 'system',
      ...(submitter?.displayName ? { ownerDisplayName: submitter.displayName } : {}),
      ...(submitter?.kind ? { ownerKind: submitter.kind } : {}),
    })
    return this.withLockedWorkspace(draft.workspaceId, async (workspace) => {
      await this.deps.proposalRepository.save(proposal)
      // Submit commits so collaborators see the artefact via `git pull`.
      // Attribution stays generic until account management lands.
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
  async submitClarification(draft: ClarificationCreate & { submitterId?: UserId }): Promise<Clarification> {
    const submitter = draft.submitterId ? await this.userDirectory.resolve(draft.submitterId) : null
    const clarification = new Clarification({
      id: newClarificationId(),
      workspaceId: draft.workspaceId,
      question: draft.question,
      candidates: draft.candidates,
      status: 'pending',
      ...(draft.externalReferences ? { externalReferences: draft.externalReferences } : {}),
      origin: draft.origin ?? 'skill',
      ...(draft.context ? { context: draft.context } : {}),
      ...(draft.relatedNode ? { relatedNode: draft.relatedNode } : {}),
      ...(draft.ambiguityType ? { ambiguityType: draft.ambiguityType } : {}),
      owner: draft.submitterId ?? 'system',
      ...(submitter?.displayName ? { ownerDisplayName: submitter.displayName } : {}),
      ...(submitter?.kind ? { ownerKind: submitter.kind } : {}),
    })
    return this.withLockedWorkspace(draft.workspaceId, async (workspace) => {
      await this.deps.clarificationRepository.save(clarification)
      await this.commitWorkspaceChange(workspace, {
        kind: 'clarification-submit',
        subject: `submitted ${clarification.id}`,
        userId: SUBMIT_USER_ID,
        clarificationId: clarification.id,
      })
      this.deps.eventBus?.publish({
        type: 'clarification.created',
        workspaceId: clarification.workspaceId,
        clarificationId: clarification.id,
        at: this.deps.clock.now(),
      })
      return clarification
    })
  }

  async applyProposal(proposalId: ProposalId, userId: UserId): Promise<Proposal> {
    // Outer load discovers the workspace for the lock key. The inner load is the authoritative read post-lock.
    const initial = await this.deps.proposalRepository.load(proposalId)
    return this.withLockedWorkspace(initial.workspaceId, async (workspace) => {
      const proposal = await this.deps.proposalRepository.load(proposalId)
      const applied = proposal.markApplied(userId, this.deps.clock.now())
      await this.assertOperationsValid(proposal.workspaceId, [...proposal.operations])
      await this.deps.modelRepository.applyOperations(proposal.workspaceId, [...proposal.operations])
      await this.deps.proposalRepository.save(applied)
      await this.commitWorkspaceChange(
        workspace,
        { kind: 'proposal-apply', subject: `applied ${proposalId}`, userId, proposalId },
        { syncModel: true },
      )
      this.deps.eventBus?.publish({
        type: 'proposal.applied',
        workspaceId: proposal.workspaceId,
        proposalId: proposal.id,
        at: this.deps.clock.now(),
      })
      return applied
    })
  }

  async rejectProposal(proposalId: ProposalId, reason: string, userId: UserId): Promise<Proposal> {
    const proposal = await this.deps.proposalRepository.load(proposalId)
    return this.withLockedWorkspace(proposal.workspaceId, async (workspace) => {
      const rejected = proposal.markRejected(userId, this.deps.clock.now())
      await this.deps.proposalRepository.save(rejected)
      await this.commitWorkspaceChange(workspace, {
        kind: 'proposal-reject',
        subject: `rejected ${proposalId}: ${reason}`,
        userId,
        proposalId,
      })
      this.deps.eventBus?.publish({
        type: 'proposal.rejected',
        workspaceId: proposal.workspaceId,
        proposalId: proposal.id,
        at: this.deps.clock.now(),
      })
      return rejected
    })
  }

  // `note` is free-text saved on the answer commit subject.
  async answerClarification(options: {
    clarificationId: ClarificationId
    selection:
      | { kind: 'existing', candidateId: ClarificationCandidateId }
      | { kind: 'custom', description: string }
    userId: UserId
    note?: string
  }): Promise<Clarification> {
    const { clarificationId, selection, userId, note } = options
    let clarification = await this.deps.clarificationRepository.load(clarificationId)
    let candidateId: ClarificationCandidateId
    if (selection.kind === 'existing') {
      candidateId = selection.candidateId
    }
    else {
      const newCandidate: ClarificationCandidate = {
        id: newClarificationCandidateId(),
        description: selection.description,
        sourceReferences: [],
        proposedOperations: [],
      }
      clarification = clarification.appendCandidate(newCandidate)
      candidateId = newCandidate.id
    }
    const operations = [...clarification.resolveCandidate(candidateId)]
    await this.assertOperationsValid(clarification.workspaceId, operations)

    return this.withLockedWorkspace(clarification.workspaceId, async (workspace) => {
      const answered = clarification.markAnswered(candidateId, userId)
      await this.deps.clarificationRepository.save(answered)
      await this.commitWorkspaceChange(workspace, {
        kind: 'clarification-answer',
        subject: `answered ${clarificationId}${note ? `: ${note}` : ''}`,
        userId,
        clarificationId,
      })
      this.deps.eventBus?.publish({
        type: 'clarification.answered',
        workspaceId: clarification.workspaceId,
        clarificationId: clarification.id,
        at: this.deps.clock.now(),
      })
      return answered
    })
  }

  // No graph mutation here. The Proposal apply path (when there is one) handled that.
  async markClarificationApplied(
    clarificationId: ClarificationId,
    userId: UserId,
    proposalId?: ProposalId,
  ): Promise<Clarification> {
    const clarification = await this.deps.clarificationRepository.load(clarificationId)
    return this.withLockedWorkspace(clarification.workspaceId, async (workspace) => {
      const applied = clarification.markApplied(proposalId)
      await this.deps.clarificationRepository.save(applied)
      await this.commitWorkspaceChange(workspace, {
        kind: 'clarification-apply',
        subject: `closed ${clarificationId}`,
        userId,
        clarificationId,
        ...(proposalId ? { proposalId } : {}),
      })
      this.deps.eventBus?.publish({
        type: 'clarification.applied',
        workspaceId: clarification.workspaceId,
        clarificationId: clarification.id,
        ...(proposalId ? { proposalId } : {}),
        at: this.deps.clock.now(),
      })
      return applied
    })
  }

  async skipClarification(
    clarificationId: ClarificationId,
    reason: string,
    userId: UserId,
  ): Promise<Clarification> {
    const clarification = await this.deps.clarificationRepository.load(clarificationId)
    return this.withLockedWorkspace(clarification.workspaceId, async (workspace) => {
      const skipped = clarification.markSkipped(userId)
      await this.deps.clarificationRepository.save(skipped)
      await this.commitWorkspaceChange(workspace, {
        kind: 'clarification-skip',
        subject: `skipped ${clarificationId}: ${reason}`,
        userId,
        clarificationId,
      })
      this.deps.eventBus?.publish({
        type: 'clarification.skipped',
        workspaceId: clarification.workspaceId,
        clarificationId: clarification.id,
        at: this.deps.clock.now(),
      })
      return skipped
    })
  }

  // Every HITL mutation runs serialised per workspace, with the workspace loaded.
  // Centralising the lock key and the load keeps that guard in one place.
  private withLockedWorkspace<T>(
    workspaceId: WorkspaceId,
    body: (workspace: Workspace) => Promise<T>,
  ): Promise<T> {
    return this.workspaceLock.run(workspaceId, async () => {
      const workspace = await this.deps.workspaceService.findById(workspaceId)
      return body(workspace)
    })
  }

  private async assertOperationsValid(
    workspaceId: WorkspaceId,
    operations: readonly GraphOperation[],
  ): Promise<void> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const snapshot = await this.deps.modelRepository.load(workspaceId)
    const result = await this.deps.modelValidationService.validateOperations(snapshot, operations, workspace)
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

  // Caller must hold the per-workspace lock. No-op when history/serializer deps weren't wired.
  private async commitWorkspaceChange(
    workspace: Workspace,
    message: CommitMessage,
    options: { syncModel: boolean } = { syncModel: false },
  ): Promise<void> {
    if (!this.deps.history || !this.deps.modelSerializer)
      return
    if (options.syncModel) {
      const snapshot = await this.deps.modelRepository.load(workspace.id)
      await this.deps.modelSerializer.write(workspace, snapshot)
    }
    const enriched = await enrichCommitAuthor(message, this.userDirectory)
    const sha = await this.deps.history.commit(workspace, enriched)
    this.deps.eventBus?.publish({
      type: 'history.committed',
      workspaceId: workspace.id,
      sha,
      at: this.deps.clock.now(),
    })
  }
}
