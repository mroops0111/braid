import type {
  BatchPlan as BatchPlanData,
  BatchPlanId,
  PlanUnit,
  PlanUnitId,
  ProposalId,
  SkillRunId,
  SourceId,
  WorkspaceId,
} from '@braidhq/schema'
import { at, T0 } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { BatchPlan, ConflictError } from '../../../src/index.js'

const T1 = at(1)
const T2 = at(2)

const workspaceId = 'w-1' as WorkspaceId
const planId = 'bp-2026-06-03-aaaa' as BatchPlanId
const unitA = 'pu-a' as PlanUnitId
const unitB = 'pu-b' as PlanUnitId

function makeUnit(id: PlanUnitId, name: string): PlanUnit {
  return {
    id,
    name,
    description: `walk ${name}`,
    sourceId: name as SourceId,
    status: 'pending',
    proposalIds: [],
    clarifyTicketIds: [],
  }
}

function makePlan(overrides: Partial<BatchPlanData> = {}): BatchPlan {
  return new BatchPlan({
    id: planId,
    workspaceId,
    createdAt: T0,
    updatedAt: T0,
    mode: 'intent',
    status: 'idle',
    autoApply: false,
    units: [makeUnit(unitA, 'prd'), makeUnit(unitB, 'design')],
    ...overrides,
  })
}

describe('BatchPlan', () => {
  describe('beginRun', () => {
    it('intent-mode goes idle → running and stamps baseline tag', () => {
      const plan = makePlan().beginRun(T1, 'batch-baseline-T1')
      expect(plan.status).toBe('running')
      expect(plan.baselineTag).toBe('batch-baseline-T1')
      expect(plan.updatedAt).toBe(T1)
    })

    it('scan-mode goes idle → scanning', () => {
      const plan = makePlan({ mode: 'scan', units: [] }).beginRun(T1, 'tag')
      expect(plan.status).toBe('scanning')
    })

    it('refuses to start a plan that is not idle', () => {
      const plan = makePlan({ status: 'running' })
      expect(() => plan.beginRun(T1, 'tag')).toThrow(ConflictError)
    })
  })

  describe('promoteToRunning', () => {
    it('replaces units and moves scanning → running', () => {
      const plan = makePlan({ mode: 'scan', status: 'scanning', units: [] })
      const promoted = plan.promoteToRunning(T1, [makeUnit(unitA, 'orders')])
      expect(promoted.status).toBe('running')
      expect(promoted.units.map(u => u.id)).toEqual([unitA])
    })

    it('refuses unless current status is scanning', () => {
      const plan = makePlan({ status: 'running' })
      expect(() => plan.promoteToRunning(T1, [])).toThrow(ConflictError)
    })
  })

  describe('startUnit / completeUnit / failUnit', () => {
    it('marks the unit running, then completed with output', () => {
      const plan = makePlan({ status: 'running' })
      const running = plan.startUnit(T1, unitA, {
        unitId: unitA,
        skillRunId: 'run-1' as SkillRunId,
      })
      expect(running.units[0]!.status).toBe('running')
      expect(running.units[0]!.startedAt).toBe(T1)
      expect(running.running?.unitId).toBe(unitA)

      const completed = running.completeUnit(T2, unitA, {
        proposalIds: ['p-1' as ProposalId],
        clarifyTicketIds: [],
      })
      expect(completed.units[0]!.status).toBe('completed')
      expect(completed.units[0]!.proposalIds).toEqual(['p-1'])
      expect(completed.running).toBeUndefined()
    })

    it('failUnit records the error and clears the running pointer', () => {
      const plan = makePlan({ status: 'running' })
        .startUnit(T1, unitA, { unitId: unitA, skillRunId: 'r' as SkillRunId })
        .failUnit(T2, unitA, 'extract exit 1')
      expect(plan.units[0]!.status).toBe('failed')
      expect(plan.units[0]!.error).toBe('extract exit 1')
      expect(plan.running).toBeUndefined()
    })
  })

  describe('terminal transitions', () => {
    it('markCompleted / markFailed / markStopped clear the running pointer', () => {
      const base = makePlan({ status: 'running' }).startUnit(T1, unitA, {
        unitId: unitA,
        skillRunId: 'r' as SkillRunId,
      })
      expect(base.markCompleted(T2).status).toBe('completed')
      expect(base.markCompleted(T2).running).toBeUndefined()
      expect(base.markFailed(T2, 'boom').error).toBe('boom')
      expect(base.markStopped(T2).status).toBe('stopped')
    })
  })

  describe('archive', () => {
    it('moves completed / failed / stopped to archived', () => {
      expect(makePlan({ status: 'completed' }).archive(T2).status).toBe('archived')
      expect(makePlan({ status: 'failed' }).archive(T2).status).toBe('archived')
      expect(makePlan({ status: 'stopped' }).archive(T2).status).toBe('archived')
    })

    it('rejects archive on non-terminal status', () => {
      expect(() => makePlan({ status: 'running' }).archive(T2)).toThrow(/Cannot archive/)
      expect(() => makePlan({ status: 'scanning' }).archive(T2)).toThrow(/Cannot archive/)
      expect(() => makePlan({ status: 'idle' }).archive(T2)).toThrow(/Cannot archive/)
    })

    it('clears the running pointer', () => {
      const completed = makePlan({ status: 'running' })
        .startUnit(T1, unitA, { unitId: unitA, skillRunId: 'r' as SkillRunId })
        .markCompleted(T2)
      expect(completed.archive(T2).running).toBeUndefined()
    })
  })

  describe('toData', () => {
    it('round-trips an independent copy', () => {
      const plan = makePlan({ status: 'running' })
      const data = plan.toData()
      data.status = 'failed'
      expect(plan.status).toBe('running')
    })
  })
})
