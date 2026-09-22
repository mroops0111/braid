import { z } from 'zod'

/**
 * Prose on an id travels to every caller that sends one.
 *
 * `openapi-mcp-gateway` copies a field's description into the tool schema a
 * model reads, at every depth, so a line written once here is the line every
 * operation taking that id shows. A use site whose meaning is narrower than
 * the id itself overrides it with its own `.describe()`.
 */

export const Timestamp = z.string().datetime({ offset: true }).describe('An instant in ISO 8601 with an offset, such as `2026-01-31T09:00:00Z`.')
export type Timestamp = z.infer<typeof Timestamp>

export const CommitSha = z.string().regex(/^[0-9a-f]{40}$/, 'CommitSha must be 40 hex chars').brand<'CommitSha'>().describe('A full 40-character commit hash, never abbreviated.')
export type CommitSha = z.infer<typeof CommitSha>

export const AbsolutePath = z.string().min(1).brand<'AbsolutePath'>().describe('An absolute path on the machine the server runs on.')
export type AbsolutePath = z.infer<typeof AbsolutePath>

/** Branded: a distinct type per ID at compile time, a plain string at runtime. */
export const WorkspaceId = z.string().min(1).brand<'WorkspaceId'>().describe('Which workspace to read or write. A run is scoped to one.')
export type WorkspaceId = z.infer<typeof WorkspaceId>

export const NodeId = z.string().min(1).brand<'NodeId'>().describe('Id of a node already in the graph, as a read of the graph reports it.')
export type NodeId = z.infer<typeof NodeId>

export const EdgeId = z.string().min(1).brand<'EdgeId'>().describe('Id of an edge already in the graph, as a read of the graph reports it.')
export type EdgeId = z.infer<typeof EdgeId>

export const SourceId = z.string().min(1).brand<'SourceId'>().describe('Id of a source the workspace has registered, which the run reads through.')
export type SourceId = z.infer<typeof SourceId>

export const ProposalId = z.string().min(1).brand<'ProposalId'>().describe('Id of a proposal, which a person applies or rejects.')
export type ProposalId = z.infer<typeof ProposalId>

export const ClarificationId = z.string().min(1).brand<'ClarificationId'>().describe('Id of a clarification, which is a question waiting on a person.')
export type ClarificationId = z.infer<typeof ClarificationId>

export const ClarificationCandidateId = z.string().min(1).brand<'ClarificationCandidateId'>().describe('Id of one candidate answer offered on a clarification.')
export type ClarificationCandidateId = z.infer<typeof ClarificationCandidateId>

export const DriftIssueId = z.string().min(1).brand<'DriftIssueId'>().describe('Id of a drift issue, re-derived on each build rather than stored as resolved.')
export type DriftIssueId = z.infer<typeof DriftIssueId>

/**
 * A reader an answer is written for.
 * Branded rather than an enum,
 * because the facets a product splits its readers on belong to the ontology,
 * rather than to the framework.
 * A workspace whose readers do not split declares none.
 */
export const AudienceId = z.string().min(1).brand<'AudienceId'>().describe('One reader group, from the audiences the workspace ontology declares.')
export type AudienceId = z.infer<typeof AudienceId>

export const BlockId = z.string().min(1).brand<'BlockId'>().describe('Id of a block a run has rendered.')
export type BlockId = z.infer<typeof BlockId>

export const SkillId = z.string().min(1).brand<'SkillId'>().describe('Id of a skill the workspace offers, such as `braid:ask`.')
export type SkillId = z.infer<typeof SkillId>

export const SkillRunId = z.string().min(1).brand<'SkillRunId'>().describe('Id of one run of a skill, which the server stamps on what that run produces.')
export type SkillRunId = z.infer<typeof SkillRunId>

export const PluginId = z.string().min(1).brand<'PluginId'>().describe('Id of a plugin the deployment has loaded.')
export type PluginId = z.infer<typeof PluginId>

export const AgentId = z.string().min(1).brand<'AgentId'>().describe('Id of an agent binding the deployment can run a skill on.')
export type AgentId = z.infer<typeof AgentId>

export const OntologyId = z.string().min(1).brand<'OntologyId'>().describe('Id of the ontology a workspace declares, which names its own vocabulary.')
export type OntologyId = z.infer<typeof OntologyId>

export const UserId = z.string().min(1).brand<'UserId'>().describe('Id of a person, as the deployment identifies them.')
export type UserId = z.infer<typeof UserId>

/** Whoever acted, a user or 'system' for autonomous reactor / bootstrap actions. */
export const Actor = z.union([UserId, z.literal('system')]).describe('Who acted, a person\'s id or `system` for an unattended action.')
export type Actor = z.infer<typeof Actor>

export const SourceLocation = z.object({
  uri: z.string().min(1).describe('Where inside the source, as the source addresses itself, such as a file path.'),
  startLine: z.number().int().nonnegative().optional().describe('First line covered, counted from 1. Absent for a source with no lines.'),
  endLine: z.number().int().nonnegative().optional().describe('Last line covered, inclusive. Absent when the reference is one line.'),
  anchor: z.string().optional().describe('A named place inside the source, for one a line number cannot address.'),
}).describe('Where in a source something was read, precise enough for a reader to open it.').openapi('SourceLocation')
export type SourceLocation = z.infer<typeof SourceLocation>

export const SourceReference = z.object({
  sourceId: SourceId,
  location: SourceLocation,
  snippet: z.string().optional().describe('The few lines that carry the claim, quoted so a reader need not open the source. Send it where a quotation is what makes the reference legible.'),
}).describe('One passage of one source, cited as the evidence behind a claim.').openapi('SourceReference')
export type SourceReference = z.infer<typeof SourceReference>

/** Branded, not an enum, so callers register new kinds without editing schema. */
export const ExternalReferenceKind = z.string().min(1).brand<'ExternalReferenceKind'>().describe('What the link points at, such as `issue` or `pull-request`.')
export type ExternalReferenceKind = z.infer<typeof ExternalReferenceKind>

export const ExternalReference = z.object({
  kind: ExternalReferenceKind,
  url: z.string().url().describe('The link, absolute, which a reader opens outside Braid.'),
  label: z.string().optional().describe('Short label shown instead of the url.'),
}).describe('A link to something outside the workspace, such as a ticket or a pull request.').openapi('ExternalReference')
export type ExternalReference = z.infer<typeof ExternalReference>
