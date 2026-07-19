import { z } from 'zod'
import { ClarificationId, CommitSha, ProposalId, SourceId, Timestamp, UserId, WorkspaceId } from './common.js'
import { GraphEdge, GraphNode, ModelSnapshot } from './model.js'

// Every commit is stamped by one system operation, so this is the closed catalog of what writes to the workspace repo.
// HITL flows get granular `entity-verb` kinds, each a distinct transition. Everything else is one kind per operation,
// detail lives in the subject.
export const CommitKind = z.enum([
  'proposal-submit',
  'proposal-apply',
  'proposal-reject',
  'clarify-submit',
  'clarify-answer',
  'clarify-apply',
  'clarify-skip',
  'config',
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
  // git user.name, snapshotted at commit time. A later rename won't rewrite history.
  authorName: z.string().min(1).optional(),
  // git user.email: real OAuth address, or synthesised `${userId}@braid.local`.
  authorEmail: z.string().min(1).optional(),
  proposalId: ProposalId.optional(),
  clarificationId: ClarificationId.optional(),
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
  status: z.enum(['added', 'updated', 'removed', 'renamed']),
  previousPath: z.string().optional(),
})
export type FileDiff = z.infer<typeof FileDiff>

// Record instead of Map so an HTTP envelope round-trips without custom JSON.
export const ChangeKind = z.enum(['added', 'updated', 'removed'])
export type ChangeKind = z.infer<typeof ChangeKind>

export const ModelDiffChanges = z.object({
  nodes: z.record(z.string(), ChangeKind),
  edges: z.record(z.string(), ChangeKind),
})
export type ModelDiffChanges = z.infer<typeof ModelDiffChanges>

// from-state for entities gone in snapshot, sparing the UI a round-trip.
export const ModelDiffEnvelope = z.object({
  from: CommitSha,
  to: CommitSha,
  snapshot: ModelSnapshot,
  removed: z.object({
    nodes: z.array(GraphNode),
    edges: z.array(GraphEdge),
  }),
  changes: ModelDiffChanges,
})
export type ModelDiffEnvelope = z.infer<typeof ModelDiffEnvelope>

export const TagMeta = z.object({
  name: z.string().min(1),
  sha: CommitSha,
  note: z.string().optional(),
  createdAt: Timestamp,
  taggedBy: z.object({ name: z.string(), email: z.string() }).optional(),
})
export type TagMeta = z.infer<typeof TagMeta>
