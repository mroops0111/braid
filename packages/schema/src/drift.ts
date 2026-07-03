import { z } from 'zod'
import { DriftIssueId, SourceReference, Timestamp } from './common.js'

export const DriftSeverity = z.enum(['error', 'warning', 'info'])
export type DriftSeverity = z.infer<typeof DriftSeverity>

// Re-derived each build, no resolved state. Fix the source or list it in acknowledgedDrifts.
// Comparison taxonomy lives in the skill prompts, so new dimensions need no migration.
export const DriftIssue = z.object({
  id: DriftIssueId,
  description: z.string().min(1),
  severity: DriftSeverity,
  sourceReferences: z.array(SourceReference).min(2),
  raisedAt: Timestamp,
})
export type DriftIssue = z.infer<typeof DriftIssue>
