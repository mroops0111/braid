import type { Audience, EmittedBlock } from '@braidhq/schema'
import { useCallback, useSyncExternalStore } from 'react'

/**
 * Which view of a run a reader is on. The first two are the answer's own two
 * halves, and `transcript` is the same run seen as the log that produced it,
 * a peer of the other two rather than something tucked underneath them.
 */
export type AnswerView = 'business' | 'engineering' | 'transcript'

const STORAGE_KEY = 'braid.answerView'
const DEFAULT_VIEW: AnswerView = 'business'
const VIEWS: readonly AnswerView[] = ['business', 'engineering', 'transcript']

// A reading habit rather than a workspace policy, so it lives with the reader.
const listeners = new Set<() => void>()

function read(): AnswerView {
  if (typeof window === 'undefined')
    return DEFAULT_VIEW
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return VIEWS.includes(stored as AnswerView) ? stored as AnswerView : DEFAULT_VIEW
}

export function useAnswerView(): [AnswerView, (next: AnswerView) => void] {
  const view = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    read,
    () => DEFAULT_VIEW,
  )
  const setView = useCallback((next: AnswerView) => {
    window.localStorage.setItem(STORAGE_KEY, next)
    for (const listener of listeners)
      listener()
  }, [])
  return [view, setView]
}

export function matchesAudience(audience: Audience, view: 'business' | 'engineering'): boolean {
  return audience === 'both' || audience === view
}

export function visibleBlocks(
  blocks: readonly EmittedBlock[],
  view: 'business' | 'engineering',
): readonly EmittedBlock[] {
  return blocks.filter(entry => matchesAudience(entry.block.audience, view))
}
