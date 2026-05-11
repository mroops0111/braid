import { z } from 'zod'
import {
  ClarifyTicketId,
  DecisionId,
  ProposalId,
  QuestionId,
  Timestamp,
  UserId,
} from './common.js'

export const DecisionAction = z.enum([
  'applyProposal',
  'rejectProposal',
  'answerClarifyTicket',
  'skipClarifyTicket',
  'manualEdit',
])
export type DecisionAction = z.infer<typeof DecisionAction>

export const DecisionActor = z.union([UserId, z.literal('system')])
export type DecisionActor = z.infer<typeof DecisionActor>

export const DecisionReferences = z.object({
  proposalId: ProposalId.optional(),
  clarifyTicketId: ClarifyTicketId.optional(),
  questionId: QuestionId.optional(),
})
export type DecisionReferences = z.infer<typeof DecisionReferences>

export const Decision = z.object({
  id: DecisionId,
  timestamp: Timestamp,
  action: DecisionAction,
  by: DecisionActor,
  rationale: z.string().optional(),
  references: DecisionReferences,
})
export type Decision = z.infer<typeof Decision>
