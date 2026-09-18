import type { OutputForm, RunRecord } from '@braidhq/schema'
import { useState } from 'react'

/**
 * The form the reader wants the next run to produce.
 *
 * A decision per conversation, not a habit that follows the reader around.
 * Rendering is what a run gives back that its transcript cannot,
 * so anything able to produce blocks starts out producing them,
 * and asking for prose is the exception a reader makes once, deliberately,
 * rather than a setting left on from a question they no longer remember.
 * Shown beside the question rather than filed away in a setting,
 * since it costs money and cannot be undone once the run has finished.
 */
export function useOutputForm(): [OutputForm, (next: OutputForm) => void] {
  const [form, setForm] = useState<OutputForm>('blocks')
  return [form, setForm]
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
