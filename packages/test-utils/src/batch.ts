import type { BatchPlan as BatchPlanData, BatchPlanId, BatchUnit, BatchUnitId, WorkspaceId } from '@braidhq/schema'
import { BatchPlan } from '@braidhq/core'
import { T0 } from './time.js'

/** Construct a BatchUnit fixture, a pending unit named by its id. Override any field per test. */
export function makeUnit(id: string, overrides: Partial<BatchUnit> = {}): BatchUnit {
  return {
    id: id as BatchUnitId,
    name: id,
    description: `walk ${id}`,
    status: 'pending',
    proposalIds: [],
    clarificationIds: [],
    ...overrides,
  }
}

/** Construct a BatchPlan fixture, an idle direct-mode plan of two pending units. Override any field per test. */
export function makePlan(overrides: Partial<BatchPlanData> = {}): BatchPlan {
  return new BatchPlan({
    id: 'bp-2026-06-03-aaaa' as BatchPlanId,
    workspaceId: 'w-1' as WorkspaceId,
    createdAt: T0,
    updatedAt: T0,
    mode: 'direct',
    status: 'idle',
    autoApply: false,
    units: [makeUnit('pu-a'), makeUnit('pu-b')],
    checkpointPhases: [],
    ...overrides,
  })
}
