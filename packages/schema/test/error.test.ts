import { describe, expect, it } from 'vitest'
import { BraidProblemJson } from '../src/index.js'

const valid = {
  type: 'https://braid.dev/problems/braid-val',
  title: 'Validation failed',
  status: 404,
  code: 'BRAID-VAL',
}

describe('BraidProblemJson', () => {
  it('parses a minimal problem document', () => {
    expect(BraidProblemJson.parse(valid).code).toBe('BRAID-VAL')
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
