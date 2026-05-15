import { z } from 'zod'
import { EdgeId, NodeId } from './common.js'

export const ValidationSeverity = z.enum(['error', 'warning', 'info'])
export type ValidationSeverity = z.infer<typeof ValidationSeverity>

export const ValidationCode = z.string().min(1).brand<'ValidationCode'>()
export type ValidationCode = z.infer<typeof ValidationCode>

export const ValidationIssue = z.object({
  code: ValidationCode,
  severity: ValidationSeverity,
  message: z.string().min(1),
  nodeId: NodeId.optional(),
  edgeId: EdgeId.optional(),
  path: z.string().optional(),
})
export type ValidationIssue = z.infer<typeof ValidationIssue>

export const ValidationIssues = z.array(ValidationIssue)
export type ValidationIssues = z.infer<typeof ValidationIssues>

export const ValidationResult = z.object({
  ok: z.boolean(),
  issues: ValidationIssues.default([]),
})
export type ValidationResult = z.infer<typeof ValidationResult>
