import type {
  ClarificationAnswerMode,
  ClarificationCandidate,
  ClarificationCandidateId,
  ClarificationCreate,
  ClarificationId,
  CommitMessage,
  GraphOperation,
  ProposalCreate,
  ProposalId,
  SkillRunId,
  SourceUnit,
  ValidationIssue,
  WorkspaceId,
} from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { WorkspaceHistory } from '../domain/history/WorkspaceHistory.js'
import type { ClarificationRepository } from '../domain/hitl/ClarificationRepository.js'
import type { ProposalRepository } from '../domain/hitl/ProposalRepository.js'
import type { RunSubmissionRule } from '../domain/hitl/runSubmission.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { ModelSerializer } from '../domain/model/ModelSerializer.js'
import type { RunRepository } from '../domain/skill/RunRepository.js'
import type { SourceUnitDigest } from '../domain/source/SourceUnitDigest.js'
import type { UserDirectory } from '../domain/users/UserDirectory.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { UnitLister } from './BatchService.js'
import type { ModelValidationService } from './ModelValidationService.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { SourceId, UserId } from '@braidhq/schema'
import { ConflictError, ValidationError } from '../domain/errors.js'
import { Clarification } from '../domain/hitl/Clarification.js'
import { Proposal } from '../domain/hitl/Proposal.js'
import { clarificationSubmission, proposalSubmission } from '../domain/hitl/runSubmission.js'
import { newClarificationCandidateId, newClarificationId, newProposalId } from '../domain/ids.js'
import { runScope } from '../domain/skill/runScope.js'
import { sourceUnitsForRun } from '../domain/source/sourceUnitsForRun.js'
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
  /**
   * All three needed to stamp which source units a proposal came from, and at
   * which version. Absent, the proposal carries none, and coverage falls back
   * to reading the run's own arguments.
   */
  runRepository?: RunRepository
  unitLister?: UnitLister
  sourceUnitDigest?: SourceUnitDigest
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

  /**
   * The source units the run that produced this was pointed at.
   *
   * Read from the run's own arguments and the observation store, never from
   * the caller. A proposal that could name its own scope could name a document
   * it never read, and coverage would then rest on the model's account of
   * itself rather than on what the server watched it do.
   */
  private async scopeOfRun(workspaceId: WorkspaceId, skillRunId: SkillRunId | undefined): Promise<SourceUnit[]> {
    const { runRepository, unitLister, sourceUnitDigest } = this.deps
    if (!skillRunId || !runRepository || !unitLister || !sourceUnitDigest)
      return []
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const record = (await runRepository.listRecords(workspace)).find(item => item.runId === skillRunId)
    if (!record)
      return []
    const named = sourceUnitsForRun(runScope(record), await unitLister(workspace))
    // Hashed here rather than read from the observation store, which records
    // what a completed run saw and so is either absent or one version behind
    // at the moment a proposal is filed.
    return Promise.all(named.map(async unit => ({
      sourceId: SourceId.parse(unit.sourceId),
      path: unit.value,
      sha: await sourceUnitDigest.computeSha(workspace, SourceId.parse(unit.sourceId), unit.value),
    })))
  }

  /**
   * What a run has already committed to, read from what it wrote.
   *
   * Checked against the records rather than against anything held in memory,
   * because a process restart must not let a run submit twice. Which rule
   * applies is the kind's own, so a new kind of output brings a rule with it
   * rather than another arm of a conditional here.
   */
  private async assertRunMaySubmit(
    workspaceId: WorkspaceId,
    skillRunId: SkillRunId | undefined,
    rule: RunSubmissionRule,
  ): Promise<void> {
    if (!skillRunId)
      return
    const [proposals, pending] = await Promise.all([
      this.deps.proposalRepository.list({ workspaceId }),
      this.deps.clarificationRepository.list({ workspaceId, statuses: ['pending'] }),
    ])
    const refusal = rule.refuse(skillRunId, {
      proposals: proposals.filter(proposal => proposal.skillRunId === skillRunId),
      blocking: pending.filter(
        clarification => clarification.skillRunId === skillRunId && clarification.answerMode === 'resumes',
      ),
    })
    if (refusal)
      throw new ConflictError(refusal)
  }

  /**
   * Whether a conversation will be parked on this answer.
   *
   * A watched run stops and waits, so answering carries it on. An unattended
   * one has nobody to answer it in time, so its question stands alone from the
   * moment it is asked. Read from the run's own record, which outlives the
   * process, rather than from anything the asker says about itself.
   */
  private async answerModeFor(
    workspaceId: WorkspaceId,
    skillRunId: SkillRunId | undefined,
  ): Promise<ClarificationAnswerMode | undefined> {
    if (!skillRunId || !this.deps.runRepository)
      return undefined
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const record = (await this.deps.runRepository.listRecords(workspace)).find(item => item.runId === skillRunId)
    if (!record)
      return undefined
    return record.unattended ? 'standing' : 'resumes'
  }

  async submitProposal(draft: ProposalCreate & { submitterId?: UserId }): Promise<Proposal> {
    await this.assertRunMaySubmit(draft.workspaceId, draft.skillRunId, proposalSubmission)
    await this.assertOperationsValid(draft.workspaceId, draft.operations)
    const generatedAt = this.deps.clock.now()
    const sourceUnits = await this.scopeOfRun(draft.workspaceId, draft.skillRunId)
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
      ...(draft.clarificationId ? { clarificationId: draft.clarificationId } : {}),
      ...(draft.skillRunId ? { skillRunId: draft.skillRunId } : {}),
      ...(sourceUnits.length > 0 ? { sourceUnits } : {}),
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
        ...(proposal.skillRunId ? { skillRunId: proposal.skillRunId } : {}),
        at: this.deps.clock.now(),
      })
      return proposal
    })
  }

  // Candidates are only validated at answer time, since each picks a different op set.
  async submitClarification(draft: ClarificationCreate & { submitterId?: UserId, skillRunId?: SkillRunId }): Promise<Clarification> {
    await this.assertRunMaySubmit(draft.workspaceId, draft.skillRunId, clarificationSubmission)
    const answerMode = await this.answerModeFor(draft.workspaceId, draft.skillRunId)
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
      ...(draft.skillRunId ? { skillRunId: draft.skillRunId } : {}),
      ...(answerMode ? { answerMode } : {}),
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
      await this.applyLinkedClarification(proposal)
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

  // Close the clarification a proposal resolved, if any, once the change lands.
  // The answered to applied move is guarded by the domain state machine,
  // so an already-closed clarification is left untouched rather than erroring.
  private async applyLinkedClarification(proposal: Proposal): Promise<void> {
    if (!proposal.clarificationId)
      return
    const clarification = await this.deps.clarificationRepository.load(proposal.clarificationId)
    if (clarification.status !== 'answered')
      return
    const applied = clarification.markApplied(proposal.id)
    await this.deps.clarificationRepository.save(applied)
    this.deps.eventBus?.publish({
      type: 'clarification.applied',
      workspaceId: proposal.workspaceId,
      clarificationId: clarification.id,
      proposalId: proposal.id,
      at: this.deps.clock.now(),
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

  /**
   * Stop a run waiting on this question, without giving the question up.
   *
   * The run carries on without the answer, so the question stops being an
   * interrupt and stands on its own. It is still pending, because it still
   * wants answering, and the step that reads answered ones will pick it up
   * whenever somebody gets to it.
   */
  async deferClarification(clarificationId: ClarificationId, userId: UserId): Promise<Clarification> {
    const clarification = await this.deps.clarificationRepository.load(clarificationId)
    return this.withLockedWorkspace(clarification.workspaceId, async (workspace) => {
      const deferred = clarification.defer()
      await this.deps.clarificationRepository.save(deferred)
      await this.commitWorkspaceChange(workspace, {
        kind: 'clarification-defer',
        subject: `deferred ${clarificationId}`,
        userId,
        clarificationId,
      })
      return deferred
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
      const blame = await this.blameUnappliedProposal(workspaceId, result.issues)
      throw new ValidationError(`${this.formatValidationErrors(result.issues)}${blame}`, result.issues)
    }
  }

  /**
   * Name the pending proposal that would supply what is missing.
   *
   * A run often proposes new nodes and asks a question about them in the same
   * breath, so answering before applying fails on a node that does exist, just
   * not yet. A bare id leaves the reviewer to work that out, and they have no
   * way to see which proposal holds it.
   */
  private async blameUnappliedProposal(
    workspaceId: WorkspaceId,
    issues: readonly ValidationIssue[],
  ): Promise<string> {
    const missing = issues.flatMap(issue => [...issue.message.matchAll(/"([^"]+)" not found/g)].map(match => match[1]!))
    if (missing.length === 0)
      return ''
    const pending = await this.deps.proposalRepository.list({ workspaceId, statuses: ['pending'] })
    for (const proposal of pending) {
      const introduced = JSON.stringify(proposal.operations)
      const supplied = missing.filter(id => introduced.includes(`"${id}"`))
      if (supplied.length > 0)
        return `. Proposal "${proposal.id}" adds ${supplied.join(', ')}, so apply it first`
    }
    return ''
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
