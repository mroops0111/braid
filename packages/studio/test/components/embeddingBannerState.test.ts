import type { EmbeddingCoverage } from '@braidhq/schema'
import type { EmbeddingProgress } from '@/lib/useEmbeddingProgress'
import { describe, expect, it } from 'vitest'
import { embeddingBannerState } from '@/components/embeddingBannerState'

function progress(overrides: Partial<EmbeddingProgress> = {}): EmbeddingProgress {
  return { rebuilding: false, done: 0, total: 0, error: null, coverage: undefined, ...overrides }
}

function coverage(overrides: Partial<EmbeddingCoverage> = {}): EmbeddingCoverage {
  return { total: 100, current: 100, stale: 0, modelId: 'bge-m3:latest', ...overrides }
}

describe('embeddingBannerState', () => {
  it('says nothing when the index is complete', () => {
    expect(embeddingBannerState(progress({ coverage: coverage() }))).toEqual({ kind: 'hidden' })
  })

  it('says nothing for the payload a deployment with no backend returns', () => {
    const noBackend = coverage({ total: 0, current: 0, stale: 0, modelId: null })
    expect(embeddingBannerState(progress({ coverage: noBackend }))).toEqual({ kind: 'hidden' })
  })

  it('reports progress while a rebuild runs', () => {
    const state = embeddingBannerState(progress({ rebuilding: true, done: 40, total: 100 }))
    expect(state).toEqual({ kind: 'rebuilding', done: 40, total: 100 })
  })

  it('reports what is left behind once a rebuild is not running', () => {
    const behind = coverage({ current: 60, stale: 40 })
    expect(embeddingBannerState(progress({ coverage: behind }))).toEqual({ kind: 'stale', stale: 40, total: 100 })
  })

  it('puts a failure above progress, since a stall is what a reader can act on', () => {
    const state = embeddingBannerState(progress({ rebuilding: true, done: 10, total: 100, error: 'ollama is down' }))
    expect(state).toEqual({ kind: 'failed', message: 'ollama is down' })
  })

  it('says nothing before coverage has loaded, rather than claiming an empty index', () => {
    expect(embeddingBannerState(progress())).toEqual({ kind: 'hidden' })
  })
})
