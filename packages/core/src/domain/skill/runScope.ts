import type { RunRecord } from '@braidhq/schema'

/**
 * What a run works on, for the surfaces that attribute work to a document.
 *
 * A fresh per-unit run is started by naming its unit, so what it was told and
 * what it works on are the same string and only one is recorded. A run that
 * carries another on is told to continue instead, and matching a document
 * against that sentence would attribute it to nothing.
 */
export function runScope(record: Pick<RunRecord, 'args' | 'scope'>): string {
  return record.scope ?? record.args
}
