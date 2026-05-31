import type {
  CommitMessage,
  CommitMeta,
  CommitSha,
  FileDiff,
  TagMeta,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { ListCommitsOptions, WorkspaceHistory } from '../domain/history/WorkspaceHistory.js'
import type { RunRepository } from '../domain/skill/RunRepository.js'
import type { SkillRunner } from '../domain/skill/SkillRunner.js'
import type { PerWorkspaceLock } from './PerWorkspaceLock.js'
import type { WorkspaceBootstrap } from './WorkspaceBootstrap.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import type { WorkspaceService } from './WorkspaceService.js'
import { ConflictError } from '../domain/errors.js'

export interface HistoryServiceDeps {
  history: WorkspaceHistory
  workspaceService: WorkspaceService
  workspaceLock: PerWorkspaceLock
  bootstrap: WorkspaceBootstrap
  runRepository: RunRepository
  skillRunner?: SkillRunner
  eventBus?: WorkspaceEventBus
  clock: Clock
}

export class HistoryService {
  constructor(private readonly deps: HistoryServiceDeps) {}

  async listCommits(workspaceId: WorkspaceId, options?: ListCommitsOptions): Promise<readonly CommitMeta[]> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    return this.deps.history.listCommits(workspace, options)
  }

  async getCommit(workspaceId: WorkspaceId, sha: CommitSha): Promise<CommitMeta | null> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    return this.deps.history.getCommit(workspace, sha)
  }

  async getCommitDiff(workspaceId: WorkspaceId, sha: CommitSha): Promise<readonly FileDiff[]> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    return this.deps.history.getCommitDiff(workspace, sha)
  }

  async restore(workspaceId: WorkspaceId, targetSha: CommitSha, userId: UserId): Promise<CommitSha> {
    return this.deps.workspaceLock.run(workspaceId, async () => {
      await this.assertNoInFlightRuns(workspaceId)
      const workspace = await this.deps.workspaceService.findById(workspaceId)
      const message: CommitMessage = {
        kind: 'restore',
        subject: `rolled back to ${targetSha.slice(0, 12)}`,
        userId,
      }
      const newSha = await this.deps.history.restore(workspace, targetSha, message)
      await this.deps.bootstrap.reloadFromDisk(workspace)
      this.deps.eventBus?.publish({
        type: 'workspace.restored',
        workspaceId,
        restoredTo: targetSha,
        newCommit: newSha,
        at: this.deps.clock.now(),
      })
      return newSha
    })
  }

  async createTag(workspaceId: WorkspaceId, sha: CommitSha, name: string, note?: string): Promise<TagMeta> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    return this.deps.history.tag(workspace, sha, name, note)
  }

  async listTags(workspaceId: WorkspaceId): Promise<readonly TagMeta[]> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    return this.deps.history.listTags(workspace)
  }

  async deleteTag(workspaceId: WorkspaceId, name: string): Promise<void> {
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    await this.deps.history.deleteTag(workspace, name)
  }

  // Refuse restore while anything skill-runner-tracked is still
  // streaming; an in-flight subprocess would write artifacts after
  // the restore commit, leaving the working tree out of sync.
  private async assertNoInFlightRuns(workspaceId: WorkspaceId): Promise<void> {
    if (!this.deps.skillRunner)
      return
    const workspace = await this.deps.workspaceService.findById(workspaceId)
    const records = await this.deps.runRepository.listRecords(workspace)
    const live = records.find(r => !r.completedAt && this.deps.skillRunner!.isActive(r.runId))
    if (live) {
      throw new ConflictError(
        `Cannot restore workspace "${workspaceId}" while run "${live.runId}" is still active`,
      )
    }
  }
}
