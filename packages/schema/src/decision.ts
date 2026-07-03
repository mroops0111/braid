import { z } from 'zod'
import {
  Actor,
  ClarifyTicketId,
  DecisionId,
  ProposalId,
  Timestamp,
  WorkspaceId,
} from './common.js'

export const DecisionAction = z.enum([
  'applyProposal',
  'rejectProposal',
  'answerClarifyTicket',
  'applyClarifyTicket',
  'skipClarifyTicket',
  'manualEdit',
])
export type DecisionAction = z.infer<typeof DecisionAction>

export const DecisionActor = Actor
export type DecisionActor = Actor

export const DecisionReferences = z.object({
  proposalId: ProposalId.optional(),
  clarifyTicketId: ClarifyTicketId.optional(),
})
export type DecisionReferences = z.infer<typeof DecisionReferences>

export const Decision = z.object({
  id: DecisionId,
  workspaceId: WorkspaceId,
  timestamp: Timestamp,
  action: DecisionAction,
  by: DecisionActor,
  rationale: z.string().optional(),
  references: DecisionReferences,
})
export type Decision = z.infer<typeof Decision>

export const DecisionFilter = z.object({
  workspaceId: WorkspaceId.optional(),
  actions: z.array(DecisionAction).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
})
export type DecisionFilter = z.infer<typeof DecisionFilter>
