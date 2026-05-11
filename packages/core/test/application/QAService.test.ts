import type {
  Answer,
  AnswerId,
  AskContext,
  Embedding,
  NodeId,
  Question,
  QuestionId,
  WorkspaceId,
} from '@telos/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QAService, ValidationError } from '../../src/index.js'
import { FakeEmbeddingIndex } from '../fakes/FakeEmbeddingIndex.js'
import { fakeIntentFragment, FakeSource, sourceIdIntent } from '../fakes/FakeSource.js'
import { InMemoryModelRepository } from '../fakes/InMemoryModelRepository.js'
import { InMemoryQAHistoryRepository } from '../fakes/InMemoryQAHistoryRepository.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00'
const workspaceId = 'w-1' as WorkspaceId
const askContext: AskContext = {
  askedBy: 'u-1' as never,
  channel: 'studio' as never,
}

const embedding: Embedding = {
  vector: [0.1, 0.2],
  modelId: 'voyage-3',
  createdAt: isoTimestamp,
}

function buildService(overrides: Partial<Parameters<typeof QAService.prototype.constructor>[0]> = {}) {
  const modelRepository = new InMemoryModelRepository()
  const embeddingIndex = new FakeEmbeddingIndex()
  const qaHistoryRepository = new InMemoryQAHistoryRepository()
  const embedText = vi.fn(async () => embedding)
  const generateAnswer = vi.fn(async () => ({
    text: 'generated answer',
    confidence: 0.9,
    generatedBy: 'agent-anthropic',
  }))

  const service = new QAService({
    modelRepository,
    embeddingIndex,
    qaHistoryRepository,
    embedText,
    generateAnswer,
    ...overrides,
  })

  return { service, modelRepository, embeddingIndex, qaHistoryRepository, embedText, generateAnswer }
}

describe('QAService.ask', () => {
  let bag: ReturnType<typeof buildService>

  beforeEach(() => {
    bag = buildService()
  })

  it('rejects empty question text', async () => {
    await expect(bag.service.ask('   ', workspaceId, askContext)).rejects.toThrow(ValidationError)
  })

  it('replays from cache when history reports a confident similar hit (layer 1)', async () => {
    const cachedQuestion: Question = {
      id: 'q-old' as QuestionId,
      text: 'old',
      embedding,
      timestamp: isoTimestamp,
      askedBy: 'u-1' as never,
      channel: 'studio' as never,
    }
    const cachedAnswer: Answer = {
      id: 'a-old' as AnswerId,
      questionId: cachedQuestion.id,
      text: 'cached answer',
      citations: [],
      generatedBy: 'agent-cached' as never,
      confidence: 0.95,
    }
    bag.qaHistoryRepository.setNextSimilarHit({
      question: cachedQuestion,
      answer: cachedAnswer,
      similarity: 0.99,
      confident: true,
    })

    const result = await bag.service.ask('similar question', workspaceId, askContext)

    expect(result.fromCache).toBe(true)
    expect(result.answer.text).toBe('cached answer')
    expect(bag.generateAnswer).not.toHaveBeenCalled()
  })

  it('falls through to graph search when cache misses (layer 2)', async () => {
    bag.embeddingIndex.setNextSearchResult(['n-1' as NodeId])
    await bag.modelRepository.applyOperations(workspaceId, [
      { op: 'addNode', payload: { type: 'command', name: 'voidTask', id: 'n-1' as NodeId } as never },
    ])

    const result = await bag.service.ask('what is voidTask?', workspaceId, askContext)

    expect(result.fromCache).toBe(false)
    expect(bag.generateAnswer).toHaveBeenCalledOnce()
    const passed = bag.generateAnswer.mock.calls[0]?.[0]
    expect(passed?.graphContext).toHaveLength(1)
    expect(passed?.sourceContext).toHaveLength(0)
  })

  it('falls back to raw source when graph search returns nothing (layer 3)', async () => {
    bag.embeddingIndex.setNextSearchResult([])
    const fallbackSource = new FakeSource(sourceIdIntent, 'intent', [
      fakeIntentFragment('voidTask is task cancellation', sourceIdIntent),
    ])
    const { service, generateAnswer } = buildService({
      resolveSources: () => [fallbackSource],
    })

    await service.ask('what is voidTask?', workspaceId, askContext)

    const passed = generateAnswer.mock.calls[0]?.[0]
    expect(passed?.graphContext).toHaveLength(0)
    expect(passed?.sourceContext).toHaveLength(1)
  })

  it('persists question + answer to history on miss path', async () => {
    expect(bag.qaHistoryRepository.count()).toBe(0)
    await bag.service.ask('question', workspaceId, askContext)
    expect(bag.qaHistoryRepository.count()).toBe(1)
  })

  it('does NOT persist when answer came from cache', async () => {
    const cachedQuestion: Question = {
      id: 'q-old' as QuestionId,
      text: 'old',
      embedding,
      timestamp: isoTimestamp,
      askedBy: 'u-1' as never,
      channel: 'studio' as never,
    }
    const cachedAnswer: Answer = {
      id: 'a-old' as AnswerId,
      questionId: cachedQuestion.id,
      text: 'cached',
      citations: [],
      generatedBy: 'agent' as never,
      confidence: 0.95,
    }
    bag.qaHistoryRepository.setNextSimilarHit({
      question: cachedQuestion,
      answer: cachedAnswer,
      similarity: 0.99,
      confident: true,
    })

    await bag.service.ask('similar', workspaceId, askContext)
    expect(bag.qaHistoryRepository.count()).toBe(0)
  })
})
