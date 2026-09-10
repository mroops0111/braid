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

/**
 * Whether a run was pointed at this unit.
 *
 * A scope naming several units joins them with a comma, and a unit path may
 * hold spaces, so the comma is the only separator. Compared whole rather than
 * by containment, because `a/b` is contained in `a/b/v2` and a
 * parent would otherwise claim every nested unit's work as its own.
 */
export function scopeCovers(scope: string, path: string): boolean {
  const wanted = normalisePath(path)
  if (wanted === '')
    return false
  return scope.split(',').map(normalisePath).includes(wanted)
}

/**
 * Whether a reference was read from inside this unit.
 *
 * A reference records a file, a unit is the directory holding it, so this is
 * containment rather than equality. Anchored on segment boundaries all the
 * same, so `prd/v2/index.md` is not read as evidence for `prd/v`.
 */
export function uriWithinUnit(uri: string, path: string): boolean {
  const unit = normalisePath(path)
  if (unit === '')
    return false
  const segments = normalisePath(uri).split('/')
  const wanted = unit.split('/')
  return segments.some((_, index) =>
    wanted.every((segment, offset) => segments[index + offset] === segment))
}

function normalisePath(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}
