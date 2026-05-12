import { z } from 'zod'
import {
  AgentId,
  AnswerId,
  NodeId,
  QuestionId,
  SourceId,
  SourceLocation,
  Timestamp,
  UserId,
} from './common.js'
import { Embedding } from './model.js'

export const QuestionChannel = z.string().min(1).brand<'QuestionChannel'>()
export type QuestionChannel = z.infer<typeof QuestionChannel>

export const Question = z.object({
  id: QuestionId,
  text: z.string().min(1),
  embedding: Embedding,
  timestamp: Timestamp,
  askedBy: UserId,
  channel: QuestionChannel,
})
export type Question = z.infer<typeof Question>

export const NodeCitation = z.object({
  kind: z.literal('node'),
  nodeId: NodeId,
  snippet: z.string(),
})
export type NodeCitation = z.infer<typeof NodeCitation>

export const SourceCitation = z.object({
  kind: z.literal('source'),
  sourceId: SourceId,
  location: SourceLocation,
  snippet: z.string(),
})
export type SourceCitation = z.infer<typeof SourceCitation>

export const Citation = z.discriminatedUnion('kind', [NodeCitation, SourceCitation])
export type Citation = z.infer<typeof Citation>

export const Answer = z.object({
  id: AnswerId,
  questionId: QuestionId,
  text: z.string(),
  citations: z.array(Citation),
  generatedBy: AgentId,
  confidence: z.number().min(0).max(1),
})
export type Answer = z.infer<typeof Answer>
