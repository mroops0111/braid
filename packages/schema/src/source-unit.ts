import { z } from 'zod'
import { SkillRunId, SourceId, Timestamp, WorkspaceId } from './common.js'

/** SHA-256 of a unit's on-disk content, branded to block arbitrary strings. */
export const SourceUnitSha = z.string().regex(/^[a-f0-9]{64}$/i).brand<'SourceUnitSha'>()
export type SourceUnitSha = z.infer<typeof SourceUnitSha>

/** A unit's identity and sha. Path keeps the trailing-slash convention so keys round-trip. */
export const SourceUnit = z.object({
  sourceId: SourceId,
  path: z.string().min(1),
  sha: SourceUnitSha,
})
export type SourceUnit = z.infer<typeof SourceUnit>

/**
 * One record per (workspaceId, sourceId, path), captured at a sha, run, and time. No lifecycle state,
 * just existence plus current sha. Ontology-neutral.
 */
export const SourceUnitObservation = z.object({
  workspaceId: WorkspaceId,
  sourceId: SourceId,
  path: z.string().min(1),
  lastObservedSha: SourceUnitSha,
  lastObservedAt: Timestamp,
  lastObservedByRunId: SkillRunId.optional(),
})
export type SourceUnitObservation = z.infer<typeof SourceUnitObservation>

/**
 * On-disk units vs recorded states, used by Reactor to decide what to re-extract.
 * - new: not in the state store
 * - changed: in the store, sha differs
 * - unchanged: in the store, sha matches (skip)
 * - orphaned: state entry whose unit is gone from disk (kept as audit trace)
 */
export const SourceUnitDiff = z.object({
  new: z.array(SourceUnit),
  changed: z.array(SourceUnit),
  unchanged: z.array(SourceUnit),
  orphaned: z.array(SourceUnitObservation),
})
export type SourceUnitDiff = z.infer<typeof SourceUnitDiff>
