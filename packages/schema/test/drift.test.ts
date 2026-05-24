import type { DriftIssueId, SourceId } from '../src/index.js'
import { describe, expect, it } from 'vitest'
import { DriftIssue, DriftSeverity } from '../src/index.js'

function sourceRef(uri: string) {
  return {
    sourceId: 'src' as SourceId,
    location: { uri },
  }
}

describe('DriftSeverity', () => {
  it('accepts error / warning / info', () => {
    expect(DriftSeverity.parse('error')).toBe('error')
    expect(DriftSeverity.parse('warning')).toBe('warning')
    expect(DriftSeverity.parse('info')).toBe('info')
  })
  it('rejects unknown severity', () => {
    expect(DriftSeverity.safeParse('fatal').success).toBe(false)
  })
})

describe('DriftIssue', () => {
  const valid = {
    id: 'd-1' as DriftIssueId,
    description: 'Intent says cap 50, code allows 99',
    severity: 'error' as const,
    sourceReferences: [sourceRef('intent/cart.md'), sourceRef('apps/api/cart.ts')],
    raisedAt: '2026-05-23T00:00:00.000Z',
  }

  it('parses minimal valid drift issue', () => {
    expect(DriftIssue.parse(valid)).toMatchObject({ id: 'd-1', severity: 'error' })
  })

  it('requires at least two sourceReferences (drift is by definition a 2-source comparison)', () => {
    const oneRef = { ...valid, sourceReferences: [sourceRef('intent/cart.md')] }
    expect(DriftIssue.safeParse(oneRef).success).toBe(false)
  })

  it('rejects empty description', () => {
    expect(DriftIssue.safeParse({ ...valid, description: '' }).success).toBe(false)
  })
})
