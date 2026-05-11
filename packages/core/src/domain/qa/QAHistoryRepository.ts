import type { Answer, Embedding, NodeId, Question } from '@telos/schema'

export interface CachedAnswer {
  question: Question
  answer: Answer
  similarity: number
  confident: boolean
}

export interface QAHistoryRepository {
  save: (question: Question, answer: Answer) => Promise<void>
  findSimilar: (embedding: Embedding, threshold?: number) => Promise<CachedAnswer | null>
  invalidate: (affectedNodeIds: NodeId[]) => Promise<void>
}
