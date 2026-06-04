import type {
  BatchInputMode,
  BatchPlan as BatchPlanData,
  BatchPlanId,
  BatchRunning,
  BatchStatus,
  ClarifyTicketId,
  PlanUnit,
  PlanUnitId,
  ProposalId,
  Timestamp,
  WorkspaceId,
} from '@braidhq/schema'
import { ConflictError } from '../errors.js'

interface UnitOutput {
  proposalIds: readonly ProposalId[]
  clarifyTicketIds: readonly ClarifyTicketId[]
}

export class BatchPlan {
  constructor(private readonly data: BatchPlanData) {}

  get id(): BatchPlanId { return this.data.id }
  get workspaceId(): WorkspaceId { return this.data.workspaceId }
  get mode(): BatchInputMode { return this.data.mode }
  get status(): BatchStatus { return this.data.status }
  get autoApply(): boolean { return this.data.autoApply }
  get baselineTag(): string | undefined { return this.data.baselineTag }
  get units(): readonly PlanUnit[] { return this.data.units }
  get running(): BatchRunning | undefined { return this.data.running }
  get error(): string | undefined { return this.data.error }
  get createdAt(): Timestamp { return this.data.createdAt }
  get updatedAt(): Timestamp { return this.data.updatedAt }

  // mode='scan' goes idle → scanning → running. mode='intent' goes idle → running.
  beginRun(now: Timestamp, baselineTag: string): BatchPlan {
    if (this.data.status !== 'idle')
      throw new ConflictError(`Batch plan ${this.data.id} is already ${this.data.status}`)
    return this.with({
      status: this.data.mode === 'scan' ? 'scanning' : 'running',
      baselineTag,
      updatedAt: now,
    })
  }

  // Called when braid-scan finished writing units back into the plan.
  promoteToRunning(now: Timestamp, units: readonly PlanUnit[]): BatchPlan {
    if (this.data.status !== 'scanning')
      throw new ConflictError(`Batch plan ${this.data.id} is not scanning (status=${this.data.status})`)
    return this.with({ status: 'running', units: [...units], updatedAt: now })
  }

  startUnit(now: Timestamp, unitId: PlanUnitId, running: BatchRunning): BatchPlan {
    return this.with({
      status: this.data.status === 'running' ? 'running' : this.data.status,
      running,
      units: this.mapUnit(unitId, unit => ({
        ...unit,
        status: 'running',
        startedAt: now,
        skillRunId: running.skillRunId,
      })),
      updatedAt: now,
    })
  }

  completeUnit(now: Timestamp, unitId: PlanUnitId, output: UnitOutput): BatchPlan {
    return this.with({
      running: undefined,
      units: this.mapUnit(unitId, unit => ({
        ...unit,
        status: 'completed',
        completedAt: now,
        proposalIds: [...output.proposalIds],
        clarifyTicketIds: [...output.clarifyTicketIds],
      })),
      updatedAt: now,
    })
  }

  failUnit(now: Timestamp, unitId: PlanUnitId, error: string): BatchPlan {
    return this.with({
      running: undefined,
      units: this.mapUnit(unitId, unit => ({
        ...unit,
        status: 'failed',
        completedAt: now,
        error,
      })),
      updatedAt: now,
    })
  }

  markCompleted(now: Timestamp): BatchPlan {
    return this.with({ status: 'completed', running: undefined, updatedAt: now })
  }

  markFailed(now: Timestamp, error: string): BatchPlan {
    return this.with({ status: 'failed', running: undefined, error, updatedAt: now })
  }

  markStopped(now: Timestamp): BatchPlan {
    return this.with({ status: 'stopped', running: undefined, updatedAt: now })
  }

  // User-driven dismiss after reviewing the report. Allowed only from a
  // terminal state so an in-flight batch can't be hidden by accident.
  // Archived plans stay on disk; the UI treats them like "no active plan"
  // and surfaces them via PreStart's "previous batch" slot.
  archive(now: Timestamp): BatchPlan {
    if (!this.isTerminal())
      throw new ConflictError(`Cannot archive plan ${this.data.id} from status=${this.data.status}`)
    return this.with({ status: 'archived', running: undefined, updatedAt: now })
  }

  // Re-enter running from a terminal state; failed units reset to pending, completed units stay.
  resumeRun(now: Timestamp): BatchPlan {
    if (!this.isTerminal())
      throw new ConflictError(`Cannot resume plan ${this.data.id} from status=${this.data.status}`)
    const units = this.data.units.map(unit => unit.status === 'failed' || unit.status === 'pending' ? resetUnit(unit) : unit)
    const patch: Partial<BatchPlanData> = {
      status: 'running',
      running: undefined,
      units,
      updatedAt: now,
    }
    delete patch.error
    return this.with(patch)
  }

  toData(): BatchPlanData {
    return structuredClone(this.data)
  }

  // Shared guard for transitions that only fire after the orchestrator
  // is done with the plan (Resume, Archive). Add new terminal states here.
  private isTerminal(): boolean {
    return this.data.status === 'completed'
      || this.data.status === 'failed'
      || this.data.status === 'stopped'
  }

  private with(patch: Partial<BatchPlanData>): BatchPlan {
    return new BatchPlan({ ...this.data, ...patch })
  }

  private mapUnit(unitId: PlanUnitId, fn: (unit: PlanUnit) => PlanUnit): PlanUnit[] {
    return this.data.units.map(u => u.id === unitId ? fn(u) : u)
  }
}

function resetUnit(unit: PlanUnit): PlanUnit {
  const fresh: PlanUnit = {
    id: unit.id,
    name: unit.name,
    description: unit.description,
    ...(unit.sourceId ? { sourceId: unit.sourceId } : {}),
    ...(unit.scopeHint ? { scopeHint: unit.scopeHint } : {}),
    status: 'pending',
    proposalIds: [],
    clarifyTicketIds: [],
  }
  return fresh
}
