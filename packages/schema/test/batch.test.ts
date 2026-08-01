import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import {
  BatchCheckpointPhaseStatus,
  BatchInputMode,
  BatchPlan,
  BatchStatus,
  BatchUnit,
  BatchUnitStatus,
} from '../src/index.js'

describe('batch enums', () => {
  it('unit status covers the per-unit lifecycle', () => {
    expect(BatchUnitStatus.options).toEqual(['pending', 'running', 'completed', 'failed', 'skipped'])
  })
  it('batch status covers the plan lifecycle', () => {
    expect(BatchStatus.options).toEqual(['idle', 'deriving', 'running', 'completed', 'failed', 'stopped', 'archived'])
  })
  it('input mode is intent or derive', () => {
    expect(BatchInputMode.options).toEqual(['intent', 'derive'])
  })
  it('checkpoint phase status is a three-state run', () => {
    expect(BatchCheckpointPhaseStatus.options).toEqual(['running', 'completed', 'failed'])
  })
})

describe('BatchUnit', () => {
  const valid = { id: 'unit-1', name: 'cart', description: 'the cart doc', status: 'pending' }

  it('defaults proposal and clarification id lists to empty', () => {
    const unit = BatchUnit.parse(valid)
    expect(unit.proposalIds).toEqual([])
    expect(unit.clarificationIds).toEqual([])
  })
  it('rejects an empty name', () => {
    expect(BatchUnit.safeParse({ ...valid, name: '' }).success).toBe(false)
  })
})

describe('BatchPlan', () => {
  const valid = {
    id: 'plan-1',
    workspaceId: 'ws-1',
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
    mode: 'intent',
    status: 'idle',
    autoApply: false,
    units: [],
  }

  it('defaults checkpointPhases to empty', () => {
    expect(BatchPlan.parse(valid).checkpointPhases).toEqual([])
  })
  it('rejects a zero checkpoint chunk size', () => {
    const bad = { ...valid, batchPolicy: { perUnitSkillId: 'ddd:extract', checkpointChunkSize: 0 } }
    expect(BatchPlan.safeParse(bad).success).toBe(false)
  })
})
