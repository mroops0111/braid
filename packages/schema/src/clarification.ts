import { z } from 'zod'
import {
  Actor,
  ClarificationCandidateId,
  ClarificationId,
  ExternalReference,
  NodeId,
  ProposalId,
  SourceReference,
  UserId,
  WorkspaceId,
} from './common.js'
import { GraphOperation } from './proposal.js'

// Only the hard contract here. Authoring rules (length, tone, language) live in the skill layer.
const clarificationQuestion = z.string().min(1).max(400).describe('The single question shown to the reviewer.')

export const ClarificationStatus = z.enum(['pending', 'answered', 'applied', 'skipped'])
export type ClarificationStatus = z.infer<typeof ClarificationStatus>

/** 'skill' = AI-emitted with candidates. 'human' = filed via Studio. */
export const ClarificationOrigin = z.enum(['skill', 'human'])
export type ClarificationOrigin = z.infer<typeof ClarificationOrigin>

/** Human picks this when filing to steer the AI. Skill tickets leave it unset. */
export const ClarificationAmbiguityType = z.enum(['gap', 'contradiction', 'ambiguous', 'assumption'])
export type ClarificationAmbiguityType = z.infer<typeof ClarificationAmbiguityType>

export const ClarificationCandidate = z.object({
  id: ClarificationCandidateId,
  description: z.string().min(1).max(200).regex(/^[^\n]+$/, 'Candidate description must be a single line').describe('One-line summary of this candidate resolution.'),
  sourceReferences: z.array(SourceReference).default([]),
  proposedOperations: z.array(GraphOperation).default([]),
})
export type ClarificationCandidate = z.infer<typeof ClarificationCandidate>

export const Clarification = z.object({
  id: ClarificationId,
  workspaceId: WorkspaceId,
  question: clarificationQuestion,
  candidates: z.array(ClarificationCandidate),
  status: ClarificationStatus,
  answeredBy: UserId.optional(),
  selectedCandidateId: ClarificationCandidateId.optional(),
  resolution: z.array(GraphOperation).optional(),
  // The user who filed it, or 'system' for autonomous ones. Pending is owner-only.
  owner: Actor,
  // Display-name snapshot at submit time. Absent for the 'system' owner.
  ownerDisplayName: z.string().min(1).optional(),
  // Set when the resolution becomes a Proposal, so the UI can link the two.
  proposalId: ProposalId.optional(),
  externalReferences: z.array(ExternalReference).optional(),
  origin: ClarificationOrigin,
  // Free-form background on a human-filed issue. Skill tickets leave it empty.
  context: z.string().max(2000).optional(),
  // Node the human believes the issue concerns, to help the AI scope its resolution.
  relatedNode: NodeId.optional(),
  ambiguityType: ClarificationAmbiguityType.optional(),
})
export type Clarification = z.infer<typeof Clarification>

export const ClarificationCreate = z.object({
  workspaceId: WorkspaceId,
  question: clarificationQuestion,
  candidates: z.array(ClarificationCandidate),
  externalReferences: z.array(ExternalReference).optional(),
  origin: ClarificationOrigin.optional(),
  context: z.string().max(2000).optional(),
  relatedNode: NodeId.optional(),
  ambiguityType: ClarificationAmbiguityType.optional(),
})
export type ClarificationCreate = z.infer<typeof ClarificationCreate>

/**
 * The POST body for creating a ticket. Workspace comes from the path,
 * and human-authored candidates omit their id for the server to mint.
 */
export const ClarificationCreateBody = ClarificationCreate
  .omit({ workspaceId: true })
  .extend({ candidates: z.array(ClarificationCandidate.partial({ id: true })) })
export type ClarificationCreateBody = z.infer<typeof ClarificationCreateBody>

export const ClarificationFilter = z.object({
  workspaceId: WorkspaceId.optional(),
  statuses: z.array(ClarificationStatus).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  // When set, hides others' pending tickets. Non-pending stay visible, absent shows all.
  viewerId: UserId.optional(),
  // Whether the viewer also sees service-account-owned pending. Owners only.
  includeServiceAccounts: z.boolean().optional(),
})
export type ClarificationFilter = z.infer<typeof ClarificationFilter>
