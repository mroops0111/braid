import { z } from 'zod'

export const Timestamp = z.string().datetime({ offset: true })
export type Timestamp = z.infer<typeof Timestamp>

export const CommitSha = z.string().regex(/^[0-9a-f]{40}$/, 'CommitSha must be 40 hex chars').brand<'CommitSha'>()
export type CommitSha = z.infer<typeof CommitSha>

export const AbsolutePath = z.string().min(1).brand<'AbsolutePath'>()
export type AbsolutePath = z.infer<typeof AbsolutePath>

/** Branded: a distinct type per ID at compile time, a plain string at runtime. */
export const WorkspaceId = z.string().min(1).brand<'WorkspaceId'>()
export type WorkspaceId = z.infer<typeof WorkspaceId>

export const NodeId = z.string().min(1).brand<'NodeId'>()
export type NodeId = z.infer<typeof NodeId>

export const EdgeId = z.string().min(1).brand<'EdgeId'>()
export type EdgeId = z.infer<typeof EdgeId>

export const SourceId = z.string().min(1).brand<'SourceId'>()
export type SourceId = z.infer<typeof SourceId>

export const ProposalId = z.string().min(1).brand<'ProposalId'>()
export type ProposalId = z.infer<typeof ProposalId>

export const ClarificationId = z.string().min(1).brand<'ClarificationId'>()
export type ClarificationId = z.infer<typeof ClarificationId>

export const ClarificationCandidateId = z.string().min(1).brand<'ClarificationCandidateId'>()
export type ClarificationCandidateId = z.infer<typeof ClarificationCandidateId>

export const DriftIssueId = z.string().min(1).brand<'DriftIssueId'>()
export type DriftIssueId = z.infer<typeof DriftIssueId>

export const SkillId = z.string().min(1).brand<'SkillId'>()
export type SkillId = z.infer<typeof SkillId>

export const SkillRunId = z.string().min(1).brand<'SkillRunId'>()
export type SkillRunId = z.infer<typeof SkillRunId>

export const PluginId = z.string().min(1).brand<'PluginId'>()
export type PluginId = z.infer<typeof PluginId>

export const AgentId = z.string().min(1).brand<'AgentId'>()
export type AgentId = z.infer<typeof AgentId>

export const OntologyId = z.string().min(1).brand<'OntologyId'>()
export type OntologyId = z.infer<typeof OntologyId>

export const UserId = z.string().min(1).brand<'UserId'>()
export type UserId = z.infer<typeof UserId>

/** Whoever acted, a user or 'system' for autonomous reactor / bootstrap actions. */
export const Actor = z.union([UserId, z.literal('system')])
export type Actor = z.infer<typeof Actor>

export const SourceLocation = z.object({
  uri: z.string().min(1),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  anchor: z.string().optional(),
})
export type SourceLocation = z.infer<typeof SourceLocation>

export const SourceReference = z.object({
  sourceId: SourceId,
  location: SourceLocation,
  snippet: z.string().optional(),
})
export type SourceReference = z.infer<typeof SourceReference>

/** Branded, not an enum, so callers register new kinds without editing schema. */
export const ExternalReferenceKind = z.string().min(1).brand<'ExternalReferenceKind'>()
export type ExternalReferenceKind = z.infer<typeof ExternalReferenceKind>

export const ExternalReference = z.object({
  kind: ExternalReferenceKind,
  url: z.string().url(),
  label: z.string().optional(),
})
export type ExternalReference = z.infer<typeof ExternalReference>
