import type { AudienceDescriptor, AudienceId } from '@braidhq/schema'
import { usePreference } from '../preference.js'
import { STORAGE_KEYS } from '../storage.js'

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

/**
 * The reader's stored view, resolved against what this ontology declares.
 * A stored id an ontology no longer has falls back,
 * rather than showing an empty answer.
 *
 * A reading habit rather than a workspace policy, so it lives with the reader.
 */
export function useAnswerView(audiences: readonly AudienceDescriptor[]): [AnswerView, (next: AnswerView) => void] {
  return usePreference(STORAGE_KEYS.answerView, (stored) => {
    const known = new Set<string>([TRANSCRIPT_VIEW, ...audiences.map(audience => audience.id)])
    return stored !== null && known.has(stored) ? stored as AnswerView : defaultView(audiences)
  })
}

function defaultView(audiences: readonly AudienceDescriptor[]): AnswerView {
  const preferred = audiences.find(audience => audience.default) ?? audiences[0]
  return preferred?.id ?? TRANSCRIPT_VIEW
}
