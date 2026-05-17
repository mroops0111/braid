import { z } from 'zod'
import { ValidationIssues } from './validation.js'

export const BraidProblemJson = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string().min(1),
  detail: z.string().optional(),
  // Structured validation issues, present on `BRAID-VAL` 400 responses so
  // clients can read failures programmatically (instead of parsing `detail`).
  issues: ValidationIssues.optional(),
})
export type BraidProblemJson = z.infer<typeof BraidProblemJson>
