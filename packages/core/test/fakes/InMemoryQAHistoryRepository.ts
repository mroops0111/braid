import type { Answer, Embedding, NodeId, Question } from '@telos/schema'
import type { CachedAnswer, QAHistoryRepository } from '../../src/index.js'

interface StoredEntry {
  question: Question
  answer: Answer
}

export class InMemoryQAHistoryRepository implements QAHistoryRepository {
  private entries: StoredEntry[] = []

  preload(entry: StoredEntry & { similarity?: number, confident?: boolean }): void {
    this.entries.push({ question: entry.question, answer: entry.answer })
  }

  async save(question: Question, answer: Answer): Promise<void> {
    this.entries.push({ question, answer })
  }

  async findSimilar(_embedding: Embedding, _threshold?: number): Promise<CachedAnswer | null> {
    const head = this.preloadedHit
    this.preloadedHit = null
    return head
  }

  async invalidate(_affectedNodeIds: NodeId[]): Promise<void> {
    this.entries = []
  }

  private preloadedHit: CachedAnswer | null = null

  setNextSimilarHit(hit: CachedAnswer | null): void {
    this.preloadedHit = hit
  }

  count(): number {
    return this.entries.length
  }
}
