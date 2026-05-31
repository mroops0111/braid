import { z } from 'zod'
import { ClarifyTicketId, CommitSha, ProposalId, SourceId, Timestamp, UserId, WorkspaceId } from './common.js'

export const CommitKind = z.enum([
  'proposal-apply',
  'proposal-reject',
  'clarify-answer',
  'clarify-apply',
  'clarify-skip',
  'source-sync',
  'bootstrap',
  'restore',
  'snapshot',
  'initial',
])
export type CommitKind = z.infer<typeof CommitKind>

export const CommitMessage = z.object({
  kind: CommitKind,
  subject: z.string().min(1).max(120),
  userId: UserId,
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

export const TagMeta = z.object({
  name: z.string().min(1),
  sha: CommitSha,
  note: z.string().optional(),
  createdAt: Timestamp,
  taggedBy: z.object({ name: z.string(), email: z.string() }).optional(),
})
export type TagMeta = z.infer<typeof TagMeta>
