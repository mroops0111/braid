import { z } from 'zod'
import {
  ClarifyCandidateId,
  ClarifyTicketId,
  ExternalReference,
  ProposalId,
  SourceReference,
  UserId,
  WorkspaceId,
} from './common.js'
import { GraphOperation } from './proposal.js'

export const ClarifyStatus = z.enum(['pending', 'answered', 'applied', 'skipped'])
export type ClarifyStatus = z.infer<typeof ClarifyStatus>

export const ClarifyCandidate = z.object({
  id: ClarifyCandidateId,
  description: z.string(),
  sourceReferences: z.array(SourceReference).default([]),
  proposedOperations: z.array(GraphOperation).default([]),
})
export type ClarifyCandidate = z.infer<typeof ClarifyCandidate>

export const ClarifyTicket = z.object({
  id: ClarifyTicketId,
  workspaceId: WorkspaceId,
  question: z.string().min(1),
  candidates: z.array(ClarifyCandidate),
  status: ClarifyStatus,
  answeredBy: UserId.optional(),
  selectedCandidateId: ClarifyCandidateId.optional(),
  resolution: z.array(GraphOperation).optional(),
  /**
   * Set on `pending → answered → applied` transitions when the
   * braid-clarify skill wraps the resolution into a Proposal. Lets the
   * UI link back from a ticket to the Proposal that materialised it.
   */
  proposalId: ProposalId.optional(),
  externalReferences: z.array(ExternalReference).optional(),
})
export type ClarifyTicket = z.infer<typeof ClarifyTicket>

export const ClarifyDraft = z.object({
  workspaceId: WorkspaceId,
  question: z.string().min(1),
  candidates: z.array(ClarifyCandidate),
  externalReferences: z.array(ExternalReference).optional(),
})
export type ClarifyDraft = z.infer<typeof ClarifyDraft>

export const ClarifyFilter = z.object({
  workspaceId: WorkspaceId.optional(),
  statuses: z.array(ClarifyStatus).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
})
export type ClarifyFilter = z.infer<typeof ClarifyFilter>
