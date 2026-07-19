import { describe, expect, it } from 'vitest'
import { BraidErrorCode, BraidProblemJson } from '../src/index.js'

const valid = {
  type: 'https://braid.dev/errors/braid-validation',
  title: 'Validation failed',
  status: 400,
  code: 'BRAID-VALIDATION',
}

describe('BraidErrorCode', () => {
  it('is the closed set of one code per HTTP failure class', () => {
    expect(BraidErrorCode.options).toEqual([
      'BRAID-VALIDATION',
      'BRAID-NOT-FOUND',
      'BRAID-CONFLICT',
      'BRAID-FORBIDDEN',
      'BRAID-INTERNAL',
    ])
  })
})

describe('BraidProblemJson', () => {
  it('parses a minimal problem document', () => {
    expect(BraidProblemJson.parse(valid).code).toBe('BRAID-VALIDATION')
  })
  it('rejects a code outside the closed set', () => {
    expect(BraidProblemJson.safeParse({ ...valid, code: 'BRAID-WHATEVER' }).success).toBe(false)
  })
  it('requires a url-shaped type', () => {
    expect(BraidProblemJson.safeParse({ ...valid, type: 'not-a-url' }).success).toBe(false)
  })
  it('rejects a status outside the 400 to 599 range', () => {
    expect(BraidProblemJson.safeParse({ ...valid, status: 399 }).success).toBe(false)
    expect(BraidProblemJson.safeParse({ ...valid, status: 600 }).success).toBe(false)
  })
  it('carries structured validation issues when present', () => {
    const issue = { code: 'evidence.missing', severity: 'error', message: 'no evidence' }
    const problem = BraidProblemJson.parse({ ...valid, issues: [issue] })
    expect(problem.issues).toHaveLength(1)
  })
})
