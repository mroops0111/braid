import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'

import {
  Answer,
  Citation,
  NodeCitation,
  Question,
  QuestionChannel,
  SourceCitation,
} from '../src/index.js'

const validEmbedding = {
  vector: [0.1, 0.2],
  modelId: 'voyage-3',
  createdAt: isoTimestamp,
}

describe('QuestionChannel (open brand — channels are plugin-extensible)', () => {
  it('accepts any non-empty string', () => {
    expect(QuestionChannel.parse('studio')).toBe('studio')
    expect(QuestionChannel.parse('mcp')).toBe('mcp')
  })
  it('rejects empty', () => {
    expect(QuestionChannel.safeParse('').success).toBe(false)
  })
})

describe('Question', () => {
  it('parses a complete question', () => {
    const question = Question.parse({
      id: 'q-1',
      text: 'what is voidTask?',
      embedding: validEmbedding,
      timestamp: isoTimestamp,
      askedBy: 'u-1',
      channel: 'studio',
    })
    expect(question.text).toContain('voidTask')
  })
  it('rejects empty text', () => {
    expect(
      Question.safeParse({
        id: 'q-1',
        text: '',
        embedding: validEmbedding,
        timestamp: isoTimestamp,
        askedBy: 'u-1',
        channel: 'studio',
      }).success,
    ).toBe(false)
  })
})

describe('Citation', () => {
  it('parses NodeCitation', () => {
    const citation = NodeCitation.parse({
      kind: 'node',
      nodeId: 'n-1',
      snippet: 'voidTask command',
    })
    expect(citation.kind).toBe('node')
  })

  it('parses SourceCitation', () => {
    const citation = SourceCitation.parse({
      kind: 'source',
      sourceId: 's-1',
      location: { uri: 'file:///x.ts', startLine: 5 },
      snippet: 'function voidTask()',
    })
    expect(citation.kind).toBe('source')
  })

  it('Citation discriminates by kind', () => {
    const node = Citation.parse({ kind: 'node', nodeId: 'n-1', snippet: 'x' })
    expect(node.kind).toBe('node')

    const source = Citation.parse({
      kind: 'source',
      sourceId: 's-1',
      location: { uri: 'x' },
      snippet: 'x',
    })
    expect(source.kind).toBe('source')
  })

  it('Citation rejects unknown kind', () => {
    expect(Citation.safeParse({ kind: 'mystery' }).success).toBe(false)
  })
})

describe('Answer', () => {
  it('parses with both citation kinds', () => {
    const answer = Answer.parse({
      id: 'a-1',
      questionId: 'q-1',
      text: 'voidTask voids a task.',
      citations: [
        { kind: 'node', nodeId: 'n-1', snippet: 'x' },
        { kind: 'source', sourceId: 's-1', location: { uri: 'x' }, snippet: 'y' },
      ],
      generatedBy: 'agent-anthropic',
      confidence: 0.92,
    })
    expect(answer.citations).toHaveLength(2)
  })

  it('rejects confidence > 1', () => {
    expect(
      Answer.safeParse({
        id: 'a-1',
        questionId: 'q-1',
        text: 'x',
        citations: [],
        generatedBy: 'a-1',
        confidence: 1.1,
      }).success,
    ).toBe(false)
  })
})
