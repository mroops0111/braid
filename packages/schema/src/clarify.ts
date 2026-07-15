import { z } from 'zod'
import {
  Actor,
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

// Only the hard contract here. Authoring rules (length, tone, language) live in the skill layer.
const clarifyQuestion = z.string().min(1).max(400).describe('The single question shown to the reviewer.')

export const ClarifyStatus = z.enum(['pending', 'answered', 'applied', 'skipped'])
export type ClarifyStatus = z.infer<typeof ClarifyStatus>

// 'skill' = AI-emitted with candidates. 'human' = filed via Studio.
export const ClarifyOrigin = z.enum(['skill', 'human'])
export type ClarifyOrigin = z.infer<typeof ClarifyOrigin>

// Human picks this when filing to steer the AI. Skill tickets leave it unset.
export const ClarifyAmbiguityType = z.enum(['gap', 'contradiction', 'ambiguous', 'assumption'])
export type ClarifyAmbiguityType = z.infer<typeof ClarifyAmbiguityType>

export const ClarifyCandidate = z.object({
  id: ClarifyCandidateId,
  description: z.string().min(1).max(200).regex(/^[^\n]+$/, 'Candidate description must be a single line').describe('One-line summary of this candidate resolution.'),
  sourceReferences: z.array(SourceReference).default([]),
  proposedOperations: z.array(GraphOperation).default([]),
})
export type ClarifyCandidate = z.infer<typeof ClarifyCandidate>

export const ClarifyTicket = z.object({
  id: ClarifyTicketId,
  workspaceId: WorkspaceId,
  question: clarifyQuestion,
  candidates: z.array(ClarifyCandidate),
  status: ClarifyStatus,
  answeredBy: UserId.optional(),
  selectedCandidateId: ClarifyCandidateId.optional(),
  resolution: z.array(GraphOperation).optional(),
  // The user who filed it, or 'system' for autonomous ones. Pending is owner-only.
  owner: Actor,
  // Display-name snapshot at submit time. Absent for the 'system' owner.
  ownerDisplayName: z.string().min(1).optional(),
  // Set when the resolution becomes a Proposal, so the UI can link the two.
  proposalId: ProposalId.optional(),
  externalReferences: z.array(ExternalReference).optional(),
  origin: ClarifyOrigin,
  // Free-form background on a human-filed issue. Skill tickets leave it empty.
  context: z.string().max(2000).optional(),
  // Node the human believes the issue concerns, to help the AI scope its resolution.
  relatedNode: NodeId.optional(),
  ambiguityType: ClarifyAmbiguityType.optional(),
})
export type ClarifyTicket = z.infer<typeof ClarifyTicket>

export const ClarifyTicketCreate = z.object({
  workspaceId: WorkspaceId,
  question: clarifyQuestion,
  candidates: z.array(ClarifyCandidate),
  externalReferences: z.array(ExternalReference).optional(),
  origin: ClarifyOrigin.optional(),
  context: z.string().max(2000).optional(),
  relatedNode: NodeId.optional(),
  ambiguityType: ClarifyAmbiguityType.optional(),
})
export type ClarifyTicketCreate = z.infer<typeof ClarifyTicketCreate>

// The POST body for creating a ticket. Workspace comes from the path,
// and human-authored candidates omit their id for the server to mint.
export const ClarifyCreateBody = ClarifyTicketCreate
  .omit({ workspaceId: true })
  .extend({ candidates: z.array(ClarifyCandidate.partial({ id: true })) })
export type ClarifyCreateBody = z.infer<typeof ClarifyCreateBody>

export const ClarifyFilter = z.object({
  workspaceId: WorkspaceId.optional(),
  statuses: z.array(ClarifyStatus).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  // When set, hides others' pending tickets. Non-pending stay visible, absent shows all.
  viewerId: UserId.optional(),
})
export type ClarifyFilter = z.infer<typeof ClarifyFilter>
