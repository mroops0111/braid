import type {
  CommitMessage,
  CommitMeta,
  CommitSha,
  FileDiff,
  ModelSnapshot,
  TagMeta,
} from '@braidhq/schema'
import type { ListCommitsOptions, Workspace, WorkspaceHistory } from '../../src/index.js'
import { T0 } from '@braidhq/test-utils'
import { vi } from 'vitest'

const ZERO_SHA = '0'.repeat(40) as CommitSha

/**
 * Spy double for the full `WorkspaceHistory` port. Every method is a `vi.fn`
 * returning an inert default, so a test can assert on whichever call it cares
 * about, `commit` or `ensureInitialised`, without stubbing the other nine.
 */
export class SpyWorkspaceHistory implements WorkspaceHistory {
  readonly ensureInitialised = vi.fn(async (_workspace: Workspace): Promise<void> => {})
  readonly commit = vi.fn(async (_workspace: Workspace, _message: CommitMessage): Promise<CommitSha> => ZERO_SHA)
  readonly listCommits = vi.fn(async (_ws: Workspace, _opts?: ListCommitsOptions): Promise<readonly CommitMeta[]> => [])
  readonly getCommit = vi.fn(async (): Promise<CommitMeta | null> => null)
  readonly getCommitDiff = vi.fn(async (): Promise<readonly FileDiff[]> => [])
  readonly readGraphAtCommit = vi.fn(async (): Promise<ModelSnapshot> => ({ nodes: [], edges: [] }))
  readonly restore = vi.fn(async (): Promise<CommitSha> => ZERO_SHA)
  readonly tag = vi.fn(async (): Promise<TagMeta> => ({ name: '', sha: ZERO_SHA, createdAt: T0 }))
  readonly listTags = vi.fn(async (): Promise<readonly TagMeta[]> => [])
  readonly deleteTag = vi.fn(async (): Promise<void> => {})
}
