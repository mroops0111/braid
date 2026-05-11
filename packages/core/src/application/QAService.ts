import type {
  Answer,
  AnswerId,
  AskContext,
  Embedding,
  Question,
  QuestionId,
  Timestamp,
  WorkspaceId,
} from '@telos/schema'
import type { EmbeddingIndex } from '../domain/model/EmbeddingIndex.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { CachedAnswer, QAHistoryRepository } from '../domain/qa/QAHistoryRepository.js'
import type { Source } from '../domain/source/Source.js'
import { ValidationError } from '../domain/errors.js'

export interface QAResult {
  question: Question
  answer: Answer
  fromCache: boolean
}

export interface QAServiceDeps {
  modelRepository: ModelRepository
  embeddingIndex: EmbeddingIndex
  qaHistoryRepository: QAHistoryRepository
  embedText: (text: string) => Promise<Embedding>
  generateAnswer: (input: { question: string, graphContext: unknown[], sourceContext: unknown[] }) => Promise<{ text: string, confidence: number, generatedBy: string }>
  resolveSources?: () => Source[]
}

export class QAService {
  constructor(private readonly deps: QAServiceDeps) {}

  async ask(
    text: string,
    workspaceId: WorkspaceId,
    askContext: AskContext,
    similarityThreshold = 0.85,
  ): Promise<QAResult> {
    if (text.trim().length === 0) {
      throw new ValidationError('Question text must not be empty')
    }

    const embedding = await this.deps.embedText(text)
    const question: Question = {
      id: crypto.randomUUID() as QuestionId,
      text,
      embedding,
      timestamp: this.now(),
      askedBy: askContext.askedBy,
      channel: askContext.channel,
    }

    const cached = await this.deps.qaHistoryRepository.findSimilar(embedding, similarityThreshold)
    if (cached?.confident) {
      return { question, answer: this.replay(cached, question), fromCache: true }
    }

    const graphContext = await this.collectGraphContext(workspaceId, embedding)
    const sourceContext = await this.collectSourceContext(askContext, graphContext.length)
    const generated = await this.deps.generateAnswer({ question: text, graphContext, sourceContext })

    const answer: Answer = {
      id: crypto.randomUUID() as AnswerId,
      questionId: question.id,
      text: generated.text,
      citations: [],
      generatedBy: generated.generatedBy as never,
      confidence: generated.confidence,
    }

    await this.deps.qaHistoryRepository.save(question, answer)
    return { question, answer, fromCache: false }
  }

  private async collectGraphContext(workspaceId: WorkspaceId, embedding: Embedding): Promise<unknown[]> {
    const candidateIds = await this.deps.embeddingIndex.search(
      Float32Array.from(embedding.vector),
      8,
    )
    if (candidateIds.length === 0)
      return []
    const snapshot = await this.deps.modelRepository.load(workspaceId)
    return snapshot.nodes.filter(node => candidateIds.includes(node.id))
  }

  private async collectSourceContext(askContext: AskContext, graphHits: number): Promise<unknown[]> {
    if (graphHits > 0)
      return []
    const sources = this.deps.resolveSources?.() ?? []
    if (sources.length === 0)
      return []
    const sourceScope = {
      tokens: askContext.scope?.boundedContextHints ?? [],
      pathGlobs: askContext.scope?.pathGlobs ?? [],
    }
    const collected: unknown[] = []
    for (const source of sources) {
      for await (const fragment of source.fetch({}, sourceScope)) {
        collected.push(fragment)
        if (collected.length >= 8)
          return collected
      }
    }
    return collected
  }

  private replay(cached: CachedAnswer, question: Question): Answer {
    return { ...cached.answer, questionId: question.id, id: crypto.randomUUID() as AnswerId }
  }

  private now(): Timestamp {
    return new Date().toISOString() as Timestamp
  }
}
