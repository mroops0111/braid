import type { EmbeddingProgress } from '@/lib/useEmbeddingProgress'

export type EmbeddingBannerState =
  | { kind: 'hidden' }
  | { kind: 'rebuilding', done: number, total: number }
  | { kind: 'stale', stale: number, total: number }
  | { kind: 'failed', message: string }

/**
 * What the banner should say about the index.
 *
 * A failure outranks progress,
 * since a stalled rebuild is the thing a reader can act on.
 * Nothing behind means nothing to say,
 * which also covers a deployment with no embedding backend,
 * since that reports no nodes and none behind.
 */
export function embeddingBannerState(progress: EmbeddingProgress): EmbeddingBannerState {
  if (progress.error)
    return { kind: 'failed', message: progress.error }
  if (progress.rebuilding)
    return { kind: 'rebuilding', done: progress.done, total: progress.total }
  const coverage = progress.coverage
  if (!coverage || coverage.stale === 0)
    return { kind: 'hidden' }
  return { kind: 'stale', stale: coverage.stale, total: coverage.total }
}
