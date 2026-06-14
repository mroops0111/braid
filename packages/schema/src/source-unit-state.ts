import { z } from 'zod'
import { SkillRunId, SourceId, Timestamp, WorkspaceId } from './common.js'

/**
 * Stable fingerprint of a source unit's on-disk content. SHA-256 hex.
 * Computed by the runtime at observation time; stored on each
 * `SourceUnitState`. Branded so callers can't accidentally pass an
 * arbitrary string.
 */
export const SourceUnitSha = z.string().regex(/^[a-f0-9]{64}$/i).brand<'SourceUnitSha'>()
export type SourceUnitSha = z.infer<typeof SourceUnitSha>

/**
 * A source unit's identity and current on-disk fingerprint. The shape
 * Reactor / BatchService / Studio hand around when asking "what's the
 * current state of this unit on disk vs what we last observed". The
 * trailing-slash convention from the intent scanner (folder = `name/`,
 * file = `name`) is preserved verbatim so identity keys round-trip
 * without normalisation surprises.
 */
export const SourceUnit = z.object({
  sourceId: SourceId,
  path: z.string().min(1),
  sha: SourceUnitSha,
})
export type SourceUnit = z.infer<typeof SourceUnit>

/**
 * Framework-level record of "we observed this source unit at this
 * version, via this run, at this time". One entity per
 * `(workspaceId, sourceId, path)`. Updated by `SourceUnitStateService`
 * whenever an orchestrator (Batch, Reactor, manual dispatch) finishes a
 * skill run that consumed the unit.
 *
 * No lifecycle states. Existence + current sha is all the state there
 * is. Removed source units leave their entry behind as an audit trace;
 * a later garbage-collection step may prune them.
 *
 * Deliberately ontology-neutral: this is *not* "intent extraction
 * state". Any source role (intent or code) and any consuming skill
 * (extract, model, future) can record observations here.
 */
export const SourceUnitState = z.object({
  workspaceId: WorkspaceId,
  sourceId: SourceId,
  path: z.string().min(1),
  lastObservedSha: SourceUnitSha,
  lastObservedAt: Timestamp,
  lastObservedByRunId: SkillRunId.optional(),
})
export type SourceUnitState = z.infer<typeof SourceUnitState>

/**
 * Result of comparing the on-disk units against the recorded
 * `SourceUnitState`s. Reactor consumes this directly to decide what to
 * re-extract.
 *
 * - `new`: unit not in state store
 * - `changed`: in state store, sha differs
 * - `unchanged`: in state store, sha matches (skip)
 * - `orphaned`: state entry whose unit is no longer on disk (kept for
 *   audit; not deleted in v0)
 */
export const SourceUnitDiff = z.object({
  new: z.array(SourceUnit),
  changed: z.array(SourceUnit),
  unchanged: z.array(SourceUnit),
  orphaned: z.array(SourceUnitState),
})
export type SourceUnitDiff = z.infer<typeof SourceUnitDiff>
