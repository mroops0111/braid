import { z } from 'zod'
import {
  ClarifyCandidateId,
  ClarifyTicketId,
  ExternalReference,
  SourceReference,
  UserId,
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
  question: z.string().min(1),
  candidates: z.array(ClarifyCandidate),
  status: ClarifyStatus,
  answeredBy: UserId.optional(),
  selectedCandidateId: ClarifyCandidateId.optional(),
  resolution: z.array(GraphOperation).optional(),
  externalReferences: z.array(ExternalReference).optional(),
})
export type ClarifyTicket = z.infer<typeof ClarifyTicket>

export const ClarifyFilter = z.object({
  statuses: z.array(ClarifyStatus).optional(),
})
export type ClarifyFilter = z.infer<typeof ClarifyFilter>
