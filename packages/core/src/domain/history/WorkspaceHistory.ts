import type {
  CommitMessage,
  CommitMeta,
  CommitSha,
  FileDiff,
  ModelSnapshot,
  TagMeta,
} from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

export interface ListCommitsOptions {
  readonly since?: CommitSha
  readonly limit?: number
}

export interface WorkspaceHistory {
  ensureInitialised: (workspace: Workspace) => Promise<void>
  /** No-op (returns current HEAD) when working tree is clean. */
  commit: (workspace: Workspace, message: CommitMessage) => Promise<CommitSha>
  listCommits: (workspace: Workspace, options?: ListCommitsOptions) => Promise<readonly CommitMeta[]>
  getCommit: (workspace: Workspace, sha: CommitSha) => Promise<CommitMeta | null>
  getCommitDiff: (workspace: Workspace, sha: CommitSha) => Promise<readonly FileDiff[]>
  /** Hydrates `artifacts/graph.json` from the given commit; empty snapshot when missing (pre-bootstrap commits). */
  readGraphAtCommit: (workspace: Workspace, sha: CommitSha) => Promise<ModelSnapshot>
  /** Forward-only: produces a new commit rather than rewriting history, so push/pull stays sane. */
  restore: (workspace: Workspace, targetSha: CommitSha, message: CommitMessage) => Promise<CommitSha>
  tag: (workspace: Workspace, sha: CommitSha, name: string, note?: string) => Promise<TagMeta>
  listTags: (workspace: Workspace) => Promise<readonly TagMeta[]>
  deleteTag: (workspace: Workspace, name: string) => Promise<void>
}
