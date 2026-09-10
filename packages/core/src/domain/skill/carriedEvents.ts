import type { SkillEvent } from '@braidhq/schema'

/**
 * What a run takes with it when it carries another on.
 *
 * A continued run is one piece of work seen through a second process, and a
 * reader following it needs the whole thread: what was asked, what was read,
 * the question that stopped it, and the answer that released it. Handing the
 * new run a copy of the old one's account puts all of that in one log, in
 * order, which is how the same reader already reads a follow-up on an answer.
 *
 * Bookkeeping does not travel. `completed` belongs to the process that ended,
 * `usage` is what that process spent, and `session-started` names a
 * conversation the new run opens for itself. Copying any of them would make
 * the new run report another process's ending and another process's bill.
 */
const CARRIED_OVER: ReadonlySet<SkillEvent['type']> = new Set<SkillEvent['type']>([
  'started',
  'message',
  'thinking',
  'tool-call',
  'tool-result',
  'block',
  'error',
])

export function carriedEvents(events: readonly SkillEvent[]): SkillEvent[] {
  return events.filter(event => CARRIED_OVER.has(event.type))
}
