import { z } from 'zod'
import { ClarifyTicketId, CommitSha, ProposalId, SourceId, Timestamp, UserId, WorkspaceId } from './common.js'

/**
 * What kind of workspace state change a commit represents. Drives both
 * the commit message subject convention and the timeline UI's row
 * grouping / iconography.
 *
 * - `apply`           : a Proposal was applied to the graph.
 * - `reject`          : a Proposal was rejected (status change only).
 * - `clarify-answer`  : a ClarifyTicket was answered (may produce a
 *                       follow-up Proposal commit later).
 * - `clarify-skip`    : a ClarifyTicket was skipped.
 * - `source-sync`     : an external source loader updated ingested files.
 * - `bootstrap`       : a `bootstrap` (Theme 11) batch run committed.
 * - `restore`         : a forward-only revert back to an earlier sha.
 * - `snapshot`        : an explicit user-named milestone (also taggable).
 * - `initial`         : the synthetic commit produced when auto-init
 *                       captures an already-populated workspace.
 */
export const CommitKind = z.enum([
  'apply',
  'reject',
  'clarify-answer',
  'clarify-skip',
  'source-sync',
  'bootstrap',
  'restore',
  'snapshot',
  'initial',
])
export type CommitKind = z.infer<typeof CommitKind>

/**
 * Structured payload a service hands to `WorkspaceHistory.commit`.
 * Serialised into the git commit message body as `Key: Value` trailers
 * (one per line) so that `getCommit` can parse it back without a side
 * index. Subject is the first line; trailers follow after a blank line.
 */
export const CommitMessage = z.object({
  kind: CommitKind,
  subject: z.string().min(1).max(120),
  userId: UserId,
  proposalId: ProposalId.optional(),
  clarifyTicketId: ClarifyTicketId.optional(),
  sourceId: SourceId.optional(),
  /** Set on `kind: 'restore'` commits: the sha we rolled back to. */
  revertedTo: CommitSha.optional(),
  /** Set on `kind: 'restore'` commits: the sha we rolled back from. */
  revertedFrom: CommitSha.optional(),
})
export type CommitMessage = z.infer<typeof CommitMessage>

/**
 * Light-weight stats derived from the commit's file-level diff. Lets
 * the timeline UI render `+3 −1` indicators without re-parsing the
 * full diff on every render. `null` when stats aren't computed yet
 * (e.g. the initial workspace commit).
 */
export const CommitGraphStats = z.object({
  nodesAdded: z.number().int().nonnegative(),
  nodesRemoved: z.number().int().nonnegative(),
  edgesAdded: z.number().int().nonnegative(),
  edgesRemoved: z.number().int().nonnegative(),
})
export type CommitGraphStats = z.infer<typeof CommitGraphStats>

/**
 * The parsed view of a single commit returned by `listCommits` /
 * `getCommit`. `message` is reconstructed from the structured commit
 * message body so callers never have to grep raw git output.
 */
export const CommitMeta = z.object({
  sha: CommitSha,
  workspaceId: WorkspaceId,
  message: CommitMessage,
  author: z.object({ name: z.string(), email: z.string() }),
  committedAt: Timestamp,
  parents: z.array(CommitSha),
  stats: CommitGraphStats.nullable(),
})
export type CommitMeta = z.infer<typeof CommitMeta>

/**
 * One file's change within a commit. Path is repo-relative
 * (`artifacts/graph.json`, `PRODUCT.md`, ...). `status` mirrors git's
 * porcelain letters but normalised to a closed enum so consumers
 * don't have to translate again.
 */
export const FileDiff = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'removed', 'renamed']),
  /** Set only when `status === 'renamed'`. */
  previousPath: z.string().optional(),
})
export type FileDiff = z.infer<typeof FileDiff>

/**
 * A named milestone pointing at a specific commit. Backed by a
 * lightweight git tag (so it doesn't require its own commit, and
 * survives garbage collection). The optional `note` is the tag's
 * annotation message when present.
 */
export const TagMeta = z.object({
  name: z.string().min(1),
  sha: CommitSha,
  note: z.string().optional(),
  createdAt: Timestamp,
  /** Tagger metadata; falls back to commit author for lightweight tags. */
  taggedBy: z.object({ name: z.string(), email: z.string() }).optional(),
})
export type TagMeta = z.infer<typeof TagMeta>
