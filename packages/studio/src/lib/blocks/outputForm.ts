import type { OutputForm, RunRecord } from '@braidhq/schema'
import { usePreference } from '../preference.js'
import { STORAGE_KEYS } from '../storage.js'

/**
 * The form the reader wants the next run to produce.
 *
 * A standing habit rather than a decision per question,
 * because somebody who turned prose on to stop paying for evidence
 * wants that to hold until they say otherwise.
 * It is still shown beside the question rather than filed away in a setting,
 * since it costs money and cannot be undone once the run has finished.
 */
export function useOutputForm(): [OutputForm, (next: OutputForm) => void] {
  return usePreference(STORAGE_KEYS.outputForm, stored => stored === 'prose' ? 'prose' : 'blocks')
}

/**
 * The form a conversation is already being held in.
 *
 * Read off the run rather than off the reader,
 * so a conversation lent to somebody else reads the way its author made it,
 * and a reader who prefers prose does not see an answer built from blocks
 * emptied of them.
 *
 * The earliest run wins. A conversation is one answer,
 * and later turns carry on in the form the first one set.
 */
export function formOfConversation(records: readonly RunRecord[], sessionId: string | null): OutputForm | null {
  if (sessionId === null)
    return null
  const turns = records
    .filter(record => record.sessionId === sessionId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  return turns[0]?.outputForm ?? null
}
