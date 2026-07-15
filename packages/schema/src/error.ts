import { z } from 'zod'
import { ValidationIssues } from './graph-validation.js'

// The closed set of machine-readable error codes, one per HTTP failure class.
// Carried on every error response so clients branch on the code,
// not on parsed status text.
export const BraidErrorCode = z.enum([
  'BRAID-VALIDATION',
  'BRAID-NOT-FOUND',
  'BRAID-CONFLICT',
  'BRAID-INTERNAL',
])
export type BraidErrorCode = z.infer<typeof BraidErrorCode>

export const BraidProblemJson = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: BraidErrorCode,
  detail: z.string().optional(),
  // Structured validation issues, present on BRAID-VALIDATION 400 responses.
  // Clients read failures programmatically instead of parsing detail.
  issues: ValidationIssues.optional(),
})
export type BraidProblemJson = z.infer<typeof BraidProblemJson>
