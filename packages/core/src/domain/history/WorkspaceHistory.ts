import type {
  CommitMessage,
  CommitMeta,
  CommitSha,
  FileDiff,
  TagMeta,
} from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

/**
 * Pagination / filtering knobs for `listCommits`. Mirrors the
 * conventions used by `Pagination` elsewhere in the codebase
 * (limit + cursor-style `since`) instead of inventing a new shape.
 */
export interface ListCommitsOptions {
  /** Walk backwards from this sha (exclusive). Omit for HEAD. */
  readonly since?: CommitSha
  /** Maximum number of commits to return. Defaults to 50 at the impl layer. */
  readonly limit?: number
}

/**
 * Port for workspace-scoped history operations. Every state-changing
 * action in the system funnels through `commit(...)` so the audit
 * trail stays continuous and restorable. The port deliberately
 * stays at the "git plumbing" level: callers (services) decide the
 * commit message kind and when to commit, the port only knows about
 * staging files + writing commits + walking the log.
 *
 * Implementations are expected to scope all operations to a single
 * workspace's root path; concurrency control between operations on
 * the same workspace is the caller's responsibility (use the
 * existing per-workspace `lockManager`).
 *
 * `restore` is forward-only by contract: it MUST produce a new
 * commit that brings the working tree back to the target sha,
 * rather than rewriting history. This keeps multi-user collaboration
 * (push / pull) coherent in the future.
 */
export interface WorkspaceHistory {
  /**
   * Idempotently ensure the workspace root is a git repo. If `.git/`
   * already exists, do nothing. Otherwise `git init`, install the
   * default `.gitignore`, and create the synthetic `initial` commit
   * capturing whatever artifacts are already on disk.
   */
  ensureInitialised: (workspace: Workspace) => Promise<void>

  /**
   * Stage the workspace's tracked artifacts and commit them with the
   * structured `message`. Returns the new commit's full sha. The
   * impl is expected to perform a single `git add -A` followed by a
   * commit, so the caller doesn't have to enumerate paths.
   *
   * No-op (returns the current HEAD sha) when the working tree has
   * no changes — keeps "commit a no-op rejection" cases from
   * polluting the log.
   */
  commit: (workspace: Workspace, message: CommitMessage) => Promise<CommitSha>

  /**
   * Walk the commit log newest-first, parsing each commit's
   * structured body back into a `CommitMeta`. Stats are populated
   * by diffing each commit against its first parent (or the empty
   * tree for the root commit).
   */
  listCommits: (
    workspace: Workspace,
    options?: ListCommitsOptions,
  ) => Promise<readonly CommitMeta[]>

  /**
   * Fetch a single commit by sha. Returns `null` when the sha is
   * unknown to this workspace's repo (e.g. it came from a sibling
   * branch or has been GC'd).
   */
  getCommit: (
    workspace: Workspace,
    sha: CommitSha,
  ) => Promise<CommitMeta | null>

  /**
   * File-level diff for a single commit (against its first parent).
   * Returns an empty array for empty commits or merge commits where
   * the impl can't pick a meaningful parent.
   */
  getCommitDiff: (
    workspace: Workspace,
    sha: CommitSha,
  ) => Promise<readonly FileDiff[]>

  /**
   * Forward-only revert: brings the working tree to the state at
   * `targetSha` and records that change as a new commit (so the
   * audit trail keeps moving forward, never rewriting history).
   * Callers SHOULD have already verified there are no in-flight
   * runs touching the workspace.
   */
  restore: (
    workspace: Workspace,
    targetSha: CommitSha,
    message: CommitMessage,
  ) => Promise<CommitSha>

  /**
   * Create a lightweight or annotated git tag pointing at `sha`.
   * Use lightweight (no `note`) for purely structural markers,
   * annotated (with `note`) for human-narrated milestones — the
   * timeline UI surfaces the `note` when present.
   */
  tag: (
    workspace: Workspace,
    sha: CommitSha,
    name: string,
    note?: string,
  ) => Promise<TagMeta>

  /**
   * List every tag on the workspace's repo, newest-first by the
   * tagged commit's `committedAt`. Lightweight tags lose the
   * `taggedBy` field; the impl falls back to the underlying
   * commit's author for that case.
   */
  listTags: (workspace: Workspace) => Promise<readonly TagMeta[]>

  /**
   * Remove a tag. The pointed-at commit stays reachable via its
   * sha; only the named pointer goes away.
   */
  deleteTag: (workspace: Workspace, name: string) => Promise<void>
}
