import { z } from 'zod'
import { ClarifyTicketId, CommitSha, ProposalId, SourceId, Timestamp, UserId, WorkspaceId } from './common.js'
import { GraphEdge, GraphNode, ModelSnapshot } from './model.js'

export const CommitKind = z.enum([
  'proposal-submit',
  'proposal-apply',
  'proposal-reject',
  'clarify-submit',
  'clarify-answer',
  'clarify-apply',
  'clarify-skip',
  'source-sync',
  'bootstrap',
  'restore',
  'snapshot',
  'initial',
  'batch-archive',
])
export type CommitKind = z.infer<typeof CommitKind>

export const CommitMessage = z.object({
  kind: CommitKind,
  subject: z.string().min(1).max(120),
  userId: UserId,
  /**
   * Human-readable author snapshot. When provided, becomes git's
   * `user.name` for this commit; otherwise falls back to the opaque
   * `userId`. Recorded at commit time so a future rename of the
   * underlying user record doesn't retroactively rewrite git history.
   */
  authorName: z.string().min(1).optional(),
  /**
   * Author email snapshot. Real Google address when the user logged
   * in via OAuth; synthesised `${userId}@braid.local` when absent,
   * which is what `git log` historically saw for the single-tenant
   * local install.
   */
  authorEmail: z.string().min(1).optional(),
  proposalId: ProposalId.optional(),
  clarifyTicketId: ClarifyTicketId.optional(),
  sourceId: SourceId.optional(),
  revertedTo: CommitSha.optional(),
  revertedFrom: CommitSha.optional(),
})
export type CommitMessage = z.infer<typeof CommitMessage>

export const CommitGraphStats = z.object({
  nodesAdded: z.number().int().nonnegative(),
  nodesRemoved: z.number().int().nonnegative(),
  edgesAdded: z.number().int().nonnegative(),
  edgesRemoved: z.number().int().nonnegative(),
})
export type CommitGraphStats = z.infer<typeof CommitGraphStats>

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

export const FileDiff = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'removed', 'renamed']),
  previousPath: z.string().optional(),
})
export type FileDiff = z.infer<typeof FileDiff>

// Wire-friendly Map → Record so an HTTP envelope round-trips without custom JSON.
export const ChangeKind = z.enum(['added', 'updated', 'removed'])
export type ChangeKind = z.infer<typeof ChangeKind>

export const GraphDiffChanges = z.object({
  nodes: z.record(z.string(), ChangeKind),
  edges: z.record(z.string(), ChangeKind),
})
export type GraphDiffChanges = z.infer<typeof GraphDiffChanges>

// `removed` carries from-state details for entities gone in `snapshot`, sparing the UI a second round-trip.
export const GraphDiffEnvelope = z.object({
  from: CommitSha,
  to: CommitSha,
  snapshot: ModelSnapshot,
  removed: z.object({
    nodes: z.array(GraphNode),
    edges: z.array(GraphEdge),
  }),
  changes: GraphDiffChanges,
})
export type GraphDiffEnvelope = z.infer<typeof GraphDiffEnvelope>

export const TagMeta = z.object({
  name: z.string().min(1),
  sha: CommitSha,
  note: z.string().optional(),
  createdAt: Timestamp,
  taggedBy: z.object({ name: z.string(), email: z.string() }).optional(),
})
export type TagMeta = z.infer<typeof TagMeta>
