import type { SkillEvent } from '@braidhq/schema'

/**
 * A run's own account, without the copy of the thread it was handed.
 *
 * A run that carries another on opens holding that run's events,
 * so its log reads as one thread to whoever opens that log alone.
 * A conversation already holds the run it carried on,
 * and replaying the copy there shows the reader the same turn twice.
 *
 * The copy is dropped only when its source is in the conversation,
 * so a surface showing the continuation by itself still reads whole.
 */
export function ownEvents(
  runId: string,
  events: readonly SkillEvent[],
  present: ReadonlySet<string>,
): readonly SkillEvent[] {
  const opening = events[0]
  if (opening?.type !== 'started' || opening.runId === runId || !present.has(opening.runId))
    return events
  const own = events.findIndex(event => event.type === 'started' && event.runId === runId)
  return own > 0 ? events.slice(own) : events
}
