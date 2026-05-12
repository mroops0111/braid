import { describe, expect, it } from 'vitest'
import { ValidationCode, ValidationIssue, ValidationResult, ValidationSeverity } from '../src/index.js'

describe('validationSeverity', () => {
  it('accepts error / warning / info', () => {
    expect(ValidationSeverity.parse('error')).toBe('error')
    expect(ValidationSeverity.parse('warning')).toBe('warning')
    expect(ValidationSeverity.parse('info')).toBe('info')
  })
  it('rejects unknown severity', () => {
    expect(ValidationSeverity.safeParse('fatal').success).toBe(false)
  })
})

describe('validationCode (branded)', () => {
  it('accepts non-empty string', () => {
    expect(ValidationCode.parse('TELOS-CTX-MISSING-DESC')).toBe('TELOS-CTX-MISSING-DESC')
  })
  it('rejects empty', () => {
    expect(ValidationCode.safeParse('').success).toBe(false)
  })
})

describe('validationIssue', () => {
  it('parses minimal issue', () => {
    const issue = ValidationIssue.parse({
      code: 'TELOS-NODE-NO-EDGE',
      severity: 'warning',
      message: 'orphan node',
    })
    expect(issue.severity).toBe('warning')
  })

  it('parses with nodeId / edgeId / path', () => {
    const issue = ValidationIssue.parse({
      code: 'TELOS-DUP-EDGE',
      severity: 'error',
      message: 'duplicate edge',
      nodeId: 'n-1',
      edgeId: 'e-1',
      path: 'edges[3]',
    })
    expect(issue.nodeId).toBe('n-1')
  })
})

describe('validationResult', () => {
  it('parses an ok result with no issues', () => {
    const result = ValidationResult.parse({ ok: true })
    expect(result.issues).toEqual([])
  })

  it('parses a failing result with issues', () => {
    const result = ValidationResult.parse({
      ok: false,
      issues: [
        { code: 'X', severity: 'error', message: 'bad' },
      ],
    })
    expect(result.issues).toHaveLength(1)
  })
})
