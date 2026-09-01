import type { EmbeddingCoverage } from '@braidhq/schema'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { workspaceEventsUrl } from './api'
import { queryKeys, useEmbeddingCoverage } from './queries'

export interface EmbeddingProgress {
  /** A rebuild is under way, so semantic search sees less than the whole graph. */
  readonly rebuilding: boolean
  readonly done: number
  readonly total: number
  /** Set when the last rebuild ended badly, cleared when the next one starts. */
  readonly error: string | null
  readonly coverage: EmbeddingCoverage | undefined
}

const IDLE = { rebuilding: false, done: 0, total: 0, error: null }

/**
 * Follows a rebuild as it runs.
 *
 * Its own EventSource rather than a channel through the shared one,
 * because that hook deliberately holds no state,
 * and progress is the one signal whose value is the message itself.
 */
export function useEmbeddingProgress(workspaceId: string | null): EmbeddingProgress {
  const queryClient = useQueryClient()
  const { data: coverage } = useEmbeddingCoverage(workspaceId ?? undefined)
  const [live, setLive] = useState<Omit<EmbeddingProgress, 'coverage'>>(IDLE)

  useEffect(() => {
    if (!workspaceId)
      return
    const source = new EventSource(workspaceEventsUrl(workspaceId))
    const invalidateCoverage = (): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.embeddingCoverage(workspaceId) })
    }

    source.addEventListener('embedding.started', (event) => {
      const { total } = JSON.parse((event as MessageEvent).data) as { total: number }
      setLive({ rebuilding: true, done: 0, total, error: null })
    })
    source.addEventListener('embedding.progress', (event) => {
      const { done, total } = JSON.parse((event as MessageEvent).data) as { done: number, total: number }
      setLive({ rebuilding: true, done, total, error: null })
    })
    source.addEventListener('embedding.completed', () => {
      setLive(IDLE)
      invalidateCoverage()
    })
    source.addEventListener('embedding.failed', (event) => {
      const { message } = JSON.parse((event as MessageEvent).data) as { message: string }
      setLive({ rebuilding: false, done: 0, total: 0, error: message })
      invalidateCoverage()
    })

    return () => {
      source.close()
      setLive(IDLE)
    }
  }, [workspaceId, queryClient])

  return { ...live, coverage }
}
