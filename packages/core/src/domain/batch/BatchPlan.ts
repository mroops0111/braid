import type {
  BatchCheckpointPhase,
  BatchInputMode,
  BatchPlan as BatchPlanData,
  BatchPlanId,
  BatchRunning,
  BatchStatus,
  BatchUnit,
  BatchUnitId,
  ClarificationId,
  ProposalId,
  SkillRunId,
  Timestamp,
  WorkspaceId,
} from '@braidhq/schema'
import { ConflictError } from '../errors.js'

interface UnitOutput {
  proposalIds: readonly ProposalId[]
  clarificationIds: readonly ClarificationId[]
}

export class BatchPlan {
  constructor(private readonly data: BatchPlanData) {}

  get id(): BatchPlanId { return this.data.id }
  get workspaceId(): WorkspaceId { return this.data.workspaceId }
  get mode(): BatchInputMode { return this.data.mode }
  get status(): BatchStatus { return this.data.status }
  get autoApply(): boolean { return this.data.autoApply }
  get baselineTag(): string | undefined { return this.data.baselineTag }
  get units(): readonly BatchUnit[] { return this.data.units }
  get running(): BatchRunning | undefined { return this.data.running }
  get error(): string | undefined { return this.data.error }
  get checkpointPhases(): readonly BatchCheckpointPhase[] { return this.data.checkpointPhases }
  get createdAt(): Timestamp { return this.data.createdAt }
  get updatedAt(): Timestamp { return this.data.updatedAt }

  // mode='derive' goes idle to deriving to running. mode='intent' goes idle to running.
  beginRun(now: Timestamp, baselineTag: string): BatchPlan {
    if (this.data.status !== 'idle')
      throw new ConflictError(`Batch plan ${this.data.id} is already ${this.data.status}`)
    return this.with({
      status: this.data.mode === 'derive' ? 'deriving' : 'running',
      baselineTag,
      updatedAt: now,
    })
  }

  // Called when the ontology's `deriveUnits` skill finishes writing units back into the plan.
  promoteToRunning(now: Timestamp, units: readonly BatchUnit[]): BatchPlan {
    if (this.data.status !== 'deriving')
      throw new ConflictError(`Batch plan ${this.data.id} is not deriving (status=${this.data.status})`)
    return this.with({ status: 'running', units: [...units], updatedAt: now })
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

  // User-driven dismiss after reviewing the report,
  // allowed only from a terminal state so an in-flight batch isn't hidden.
  // Archived plans stay on disk, the UI treats them like "no active plan",
  // and surfaces them via PreStart's "previous batch" slot.
  archive(now: Timestamp): BatchPlan {
    if (!this.isTerminal())
      throw new ConflictError(`Cannot archive plan ${this.data.id} from status=${this.data.status}`)
    return this.with({ status: 'archived', running: undefined, updatedAt: now })
  }

  // Re-enter running from a terminal state.
  // Failed units reset to pending, completed units stay.
  resumeRun(now: Timestamp): BatchPlan {
    if (!this.isTerminal())
      throw new ConflictError(`Cannot resume plan ${this.data.id} from status=${this.data.status}`)
    const units = this.data.units.map(unit => unit.status === 'failed' || unit.status === 'pending' ? resetUnit(unit) : unit)
    // Drop failed checkpoint phases so the upcoming chunk accounting resets.
    // Successful phases remain, their units are still recorded as completed.
    const checkpointPhases = this.data.checkpointPhases.filter(phase => phase.status === 'completed')
    const next: BatchPlanData = {
      ...this.data,
      status: 'running',
      units,
      checkpointPhases,
      updatedAt: now,
    }
    delete (next as { running?: BatchRunning }).running
    delete (next as { error?: string }).error
    return new BatchPlan(next)
  }

  markUnitRunning(now: Timestamp, unitId: BatchUnitId, running: BatchRunning): BatchPlan {
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

  markUnitCompleted(now: Timestamp, unitId: BatchUnitId, output: UnitOutput): BatchPlan {
    return this.with({
      running: undefined,
      units: this.mapUnit(unitId, unit => ({
        ...unit,
        status: 'completed',
        completedAt: now,
        proposalIds: [...output.proposalIds],
        clarificationIds: [...output.clarificationIds],
      })),
      updatedAt: now,
    })
  }

  markUnitFailed(now: Timestamp, unitId: BatchUnitId, error: string): BatchPlan {
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

  startCheckpointPhase(now: Timestamp, skillRunId: SkillRunId, unitIds: readonly BatchUnitId[]): BatchPlan {
    const newPhase: BatchCheckpointPhase = {
      status: 'running',
      unitIds: [...unitIds],
      startedAt: now,
      skillRunId,
    }
    return this.with({
      checkpointPhases: [...this.data.checkpointPhases, newPhase],
      updatedAt: now,
    })
  }

  completeCheckpointPhase(now: Timestamp): BatchPlan {
    return this.with({
      checkpointPhases: this.mapLastCheckpointPhase(phase => ({ ...phase, status: 'completed', completedAt: now })),
      updatedAt: now,
    })
  }

  failCheckpointPhase(now: Timestamp, error: string): BatchPlan {
    return this.with({
      checkpointPhases: this.mapLastCheckpointPhase(phase => ({ ...phase, status: 'failed', completedAt: now, error })),
      updatedAt: now,
    })
  }

  toData(): BatchPlanData {
    return structuredClone(this.data)
  }

  private with(patch: Partial<BatchPlanData>): BatchPlan {
    return new BatchPlan({ ...this.data, ...patch })
  }

  private mapUnit(unitId: BatchUnitId, fn: (unit: BatchUnit) => BatchUnit): BatchUnit[] {
    return this.data.units.map(unit => unit.id === unitId ? fn(unit) : unit)
  }

  private mapLastCheckpointPhase(fn: (phase: BatchCheckpointPhase) => BatchCheckpointPhase): BatchCheckpointPhase[] {
    const phases = [...this.data.checkpointPhases]
    if (phases.length === 0)
      return phases
    phases[phases.length - 1] = fn(phases[phases.length - 1]!)
    return phases
  }

  // Shared guard for transitions that only fire,
  // after the orchestrator is done with the plan, e.g. Resume or Archive.
  // Add new terminal states here.
  private isTerminal(): boolean {
    return this.data.status === 'completed'
      || this.data.status === 'failed'
      || this.data.status === 'stopped'
  }
}

function resetUnit(unit: BatchUnit): BatchUnit {
  const fresh: BatchUnit = {
    id: unit.id,
    name: unit.name,
    description: unit.description,
    ...(unit.sourceId ? { sourceId: unit.sourceId } : {}),
    ...(unit.scopeHint ? { scopeHint: unit.scopeHint } : {}),
    status: 'pending',
    proposalIds: [],
    clarificationIds: [],
  }
  return fresh
}
