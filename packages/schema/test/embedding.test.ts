import { describe, expect, it } from 'vitest'
import { NodeEmbedding } from '../src/index.js'

const isoTimestamp = '2026-05-09T00:00:00.000Z'

describe('nodeEmbedding', () => {
  const valid = {
    nodeId: 'node-1',
    vector: [0.1, 0.2, 0.3],
    modelId: 'bge-m3:latest',
    sourceHash: 'a'.repeat(64),
    createdAt: isoTimestamp,
  }

  it('parses a vector with its model and source hash', () => {
    const embedding = NodeEmbedding.parse(valid)
    expect(embedding.vector).toHaveLength(3)
    expect(embedding.modelId).toBe('bge-m3:latest')
  })

  it('rejects an empty vector, which would match everything equally', () => {
    expect(NodeEmbedding.safeParse({ ...valid, vector: [] }).success).toBe(false)
  })

  it('rejects a missing model id, since vectors from different models never mix', () => {
    expect(NodeEmbedding.safeParse({ ...valid, modelId: '' }).success).toBe(false)
  })

  it('rejects a missing source hash, which is what makes a rebuild skippable', () => {
    expect(NodeEmbedding.safeParse({ ...valid, sourceHash: '' }).success).toBe(false)
  })
})
