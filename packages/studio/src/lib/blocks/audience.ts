import type { AudienceDescriptor, AudienceId } from '@braidhq/schema'
import { useCallback, useSyncExternalStore } from 'react'

export { visibleBlocks } from './visibleBlocks.js'

/**
 * Which view of a run a reader is on.
 *
 * `transcript` is the run seen as the log that produced it,
 * a peer of the answer's views rather than something tucked underneath.
 * Everything else is an audience the ontology declared, so the set is open.
 */
export const TRANSCRIPT_VIEW = 'transcript'
export type AnswerView = AudienceId | typeof TRANSCRIPT_VIEW

const STORAGE_KEY = 'braid.answerView'

// A reading habit rather than a workspace policy, so it lives with the reader.
const listeners = new Set<() => void>()

function read(): string | null {
  if (typeof window === 'undefined')
    return null
  return window.localStorage.getItem(STORAGE_KEY)
}

/**
 * The reader's stored view, resolved against what this ontology declares.
 * A stored id an ontology no longer has falls back,
 * rather than showing an empty answer.
 */
export function useAnswerView(audiences: readonly AudienceDescriptor[]): [AnswerView, (next: AnswerView) => void] {
  const stored = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    read,
    () => null,
  )
  const setView = useCallback((next: AnswerView) => {
    window.localStorage.setItem(STORAGE_KEY, next)
    for (const listener of listeners)
      listener()
  }, [])

  const known = new Set<string>([TRANSCRIPT_VIEW, ...audiences.map(audience => audience.id)])
  const fallback = defaultView(audiences)
  return [stored !== null && known.has(stored) ? stored as AnswerView : fallback, setView]
}

function defaultView(audiences: readonly AudienceDescriptor[]): AnswerView {
  const preferred = audiences.find(audience => audience.default) ?? audiences[0]
  return preferred?.id ?? TRANSCRIPT_VIEW
}
