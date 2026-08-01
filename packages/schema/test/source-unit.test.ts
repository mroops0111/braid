import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { SourceUnit, SourceUnitDiff, SourceUnitObservation, SourceUnitSha } from '../src/index.js'

const sha = 'a'.repeat(64)

describe('SourceUnitSha', () => {
  it('accepts 64 hex chars', () => {
    expect(SourceUnitSha.parse(sha)).toBe(sha)
  })
  it('accepts uppercase hex, the regex is case-insensitive', () => {
    expect(SourceUnitSha.safeParse('A'.repeat(64)).success).toBe(true)
  })
  it('rejects the wrong length', () => {
    expect(SourceUnitSha.safeParse('a'.repeat(63)).success).toBe(false)
  })
  it('rejects a non-hex char', () => {
    expect(SourceUnitSha.safeParse('g'.repeat(64)).success).toBe(false)
  })
})

describe('SourceUnit', () => {
  it('parses identity plus sha', () => {
    const unit = SourceUnit.parse({ sourceId: 'src-1', path: 'intent/cart.md', sha })
    expect(unit.path).toBe('intent/cart.md')
  })
  it('rejects an empty path', () => {
    expect(SourceUnit.safeParse({ sourceId: 'src-1', path: '', sha }).success).toBe(false)
  })
})

describe('SourceUnitObservation', () => {
  const valid = {
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    path: 'intent/cart.md',
    lastObservedSha: sha,
    lastObservedAt: isoTimestamp,
  }

  it('parses without a run id', () => {
    expect(SourceUnitObservation.parse(valid).lastObservedByRunId).toBeUndefined()
  })
  it('carries the observing run id when present', () => {
    expect(SourceUnitObservation.parse({ ...valid, lastObservedByRunId: 'run-1' }).lastObservedByRunId).toBe('run-1')
  })
})

describe('SourceUnitDiff', () => {
  it('groups units into new, changed, unchanged, orphaned', () => {
    const diff = SourceUnitDiff.parse({ new: [], changed: [], unchanged: [], orphaned: [] })
    expect(diff).toEqual({ new: [], changed: [], unchanged: [], orphaned: [] })
  })
})
