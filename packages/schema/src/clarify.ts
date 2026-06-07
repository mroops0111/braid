import { z } from 'zod'
import {
  ClarifyCandidateId,
  ClarifyTicketId,
  ExternalReference,
  NodeId,
  ProposalId,
  SourceReference,
  UserId,
  WorkspaceId,
} from './common.js'
import { GraphOperation } from './proposal.js'

export const ClarifyStatus = z.enum(['pending', 'answered', 'applied', 'skipped'])
export type ClarifyStatus = z.infer<typeof ClarifyStatus>

/**
 * Who authored the ticket. `'skill'` = emitted by braid-extract /
 * braid-model when AI hits ambiguity; AI ships pre-authored candidates.
 * `'human'` = filed via the Studio Submit-issue affordance; candidates
 * are typically empty at submit time and AI fills them on its next
 * clarify pass. Optional for backward compat with tickets persisted
 * before this field existed (treat absent as `'skill'`).
 */
export const ClarifyOrigin = z.enum(['skill', 'human'])
export type ClarifyOrigin = z.infer<typeof ClarifyOrigin>

/**
 * Classification a human picks when filing an issue. Matches the
 * taxonomy used in ReDoc's SubmitIssueForm. Helps AI's next clarify
 * run pick the right resolution strategy when it processes a
 * human-authored ticket. Skill-emitted tickets do not set this.
 */
export const ClarifyAmbiguityType = z.enum(['gap', 'contradiction', 'ambiguous', 'assumption'])
export type ClarifyAmbiguityType = z.infer<typeof ClarifyAmbiguityType>

export const ClarifyCandidate = z.object({
  id: ClarifyCandidateId,
  description: z.string().min(1).max(200).regex(/^[^\n]+$/, 'Candidate description must be a single line').describe('One-line summary of this candidate resolution. Imperative or declarative. See content-conventions.md.'),
  sourceReferences: z.array(SourceReference).default([]),
  proposedOperations: z.array(GraphOperation).default([]),
})
export type ClarifyCandidate = z.infer<typeof ClarifyCandidate>

export const ClarifyTicket = z.object({
  id: ClarifyTicketId,
  workspaceId: WorkspaceId,
  question: z.string().min(1).max(400).describe('Single question for the reviewer, ending with `?`. Names both candidate readings. See content-conventions.md.'),
  candidates: z.array(ClarifyCandidate),
  status: ClarifyStatus,
  answeredBy: UserId.optional(),
  selectedCandidateId: ClarifyCandidateId.optional(),
  resolution: z.array(GraphOperation).optional(),
  /**
   * Human who triggered the run / submission that produced this ticket.
   * While `pending`, only the owner sees it in their list; once it
   * transitions to `answered` / `applied` / `skipped` it becomes
   * workspace-shared audit history. Absent on tickets predating Phase E.
   */
  ownerId: UserId.optional(),
  /** Snapshot of the owner's displayName at submit time. See Proposal.ownerDisplayName. */
  ownerDisplayName: z.string().min(1).optional(),
  /**
   * Set on `pending → answered → applied` transitions when the
   * braid-clarify skill wraps the resolution into a Proposal. Lets the
   * UI link back from a ticket to the Proposal that materialised it.
   */
  proposalId: ProposalId.optional(),
  externalReferences: z.array(ExternalReference).optional(),
  /** See ClarifyOrigin. Absent on tickets predating the field. */
  origin: ClarifyOrigin.optional(),
  /** Free-form background on a human-filed issue. Skill tickets leave this empty. */
  context: z.string().max(2000).optional(),
  /** Node the human believes the issue concerns; helps AI scope its resolution. */
  relatedNode: NodeId.optional(),
  /** Classification picked by the human filer; see ClarifyAmbiguityType. */
  ambiguityType: ClarifyAmbiguityType.optional(),
})
export type ClarifyTicket = z.infer<typeof ClarifyTicket>

export const ClarifyDraft = z.object({
  workspaceId: WorkspaceId,
  question: z.string().min(1).max(400).describe('Single question for the reviewer, ending with `?`. Names both candidate readings. See content-conventions.md.'),
  candidates: z.array(ClarifyCandidate),
  externalReferences: z.array(ExternalReference).optional(),
  origin: ClarifyOrigin.optional(),
  context: z.string().max(2000).optional(),
  relatedNode: NodeId.optional(),
  ambiguityType: ClarifyAmbiguityType.optional(),
})
export type ClarifyDraft = z.infer<typeof ClarifyDraft>

export const ClarifyFilter = z.object({
  workspaceId: WorkspaceId.optional(),
  statuses: z.array(ClarifyStatus).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  /**
   * When present, hides pending tickets whose `ownerId` is not the
   * viewer. Non-pending tickets stay visible to everyone (audit
   * history). Absent means "show everything" — used by owners with
   * Show All, by tests, and by bootstrap.
   */
  viewerId: UserId.optional(),
})
export type ClarifyFilter = z.infer<typeof ClarifyFilter>
