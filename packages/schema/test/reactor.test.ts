import { T0 as isoTimestamp } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import {
  ReactorCheckpointStatus,
  ReactorConfig,
  ReactorCycle,
  ReactorCycleStatus,
  ReactorUnitStatus,
} from '../src/index.js'

describe('ReactorConfig', () => {
  it('is off by default with a 5-per-hour cap', () => {
    expect(ReactorConfig.parse({})).toEqual({ enabled: false, maxRunsPerHour: 5 })
  })
  it('rejects a zero or negative cap', () => {
    expect(ReactorConfig.safeParse({ maxRunsPerHour: 0 }).success).toBe(false)
    expect(ReactorConfig.safeParse({ maxRunsPerHour: -1 }).success).toBe(false)
  })
  it('rejects a fractional cap', () => {
    expect(ReactorConfig.safeParse({ maxRunsPerHour: 1.5 }).success).toBe(false)
  })
})

describe('reactor status enums', () => {
  it('unit status omits skipped', () => {
    expect(ReactorUnitStatus.options).toEqual(['queued', 'running', 'success', 'failure'])
  })
  it('checkpoint status adds skipped', () => {
    expect(ReactorCheckpointStatus.options).toEqual(['queued', 'running', 'success', 'failure', 'skipped'])
  })
  it('cycle status covers the throttled path', () => {
    expect(ReactorCycleStatus.options).toEqual(['dispatched', 'running', 'completed', 'throttled'])
  })
})

describe('ReactorCycle', () => {
  const valid = {
    id: 'cycle-1',
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    startedAt: isoTimestamp,
    status: 'dispatched',
  }

  it('defaults units to an empty list', () => {
    expect(ReactorCycle.parse(valid).units).toEqual([])
  })
  it('parses a throttled cycle with no units and a reason', () => {
    const cycle = ReactorCycle.parse({ ...valid, status: 'throttled', throttledReason: 'cap 5/hour reached' })
    expect(cycle.throttledReason).toBe('cap 5/hour reached')
  })
})
