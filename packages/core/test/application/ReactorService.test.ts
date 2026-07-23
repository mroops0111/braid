import type { AbsolutePath, SkillEvent, SkillId, SkillRunId, SourceDescriptor, SourceId, SourceUnitSha, Timestamp, WorkspaceEvent, WorkspaceId } from '@braidhq/schema'
import type {
  IntentLister,
  SkillEventListener,
  SkillRunner,
  SkillRunSubscription,
  SourceUnitDigest,
  WorkspaceEventBus,
} from '../../src/index.js'
import { SkillId as SkillIdSchema } from '@braidhq/schema'
import { FixedClock, makeOntology, makeWorkspace, mintTestId, resetTestIds, T0 } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import {
  InMemoryReactorCycleRepository,
  InMemorySourceUnitObservationRepository,
  InMemoryWorkspaceEventBus,
  InMemoryWorkspaceRepository,
} from '../../src/in-memory.js'
import {
  PluginRegistry,
  ReactorService,
  SourceUnitObservationService,
  Workspace,
  WorkspaceLock,
  WorkspaceService,
} from '../../src/index.js'

const PER_UNIT_SKILL = SkillIdSchema.parse('ddd:extract')
const CHECKPOINT_SKILL = SkillIdSchema.parse('ddd:reconcile')

function intentSource(id: string): SourceDescriptor {
  return {
    kind: 'filesystem',
    id: id as SourceId,
    role: 'intent',
    name: id,
    path: `/abs/${id}` as AbsolutePath,
  }
}

function codeSource(id: string): SourceDescriptor {
  return {
    kind: 'filesystem',
    id: id as SourceId,
    role: 'code',
    name: id,
    path: `/abs/${id}` as AbsolutePath,
  }
}

class FakeSkillRunner implements SkillRunner {
  readonly startCalls: Array<{ skillId: SkillId, args: string }> = []
  private readonly listeners = new Map<SkillRunId, SkillEventListener>()
  // When set, start() defers completion until flushOne fires it.
  controlled = false
  // Pending completions the test fires manually while controlled.
  private readonly pending: Array<() => void> = []
  exitCodes: number[] = []

  async start(_workspace: unknown, skillId: SkillId, args: string): Promise<SkillRunId> {
    const runId = `r-${this.startCalls.length}` as SkillRunId
    this.startCalls.push({ skillId, args })
    const code = this.exitCodes.shift() ?? 0
    const fire = () => {
      const listener = this.listeners.get(runId)
      const event: SkillEvent = { type: 'completed', runId, exitCode: code, at: T0 }
      listener?.(event)
    }
    if (this.controlled)
      this.pending.push(fire)
    else
      setTimeout(fire, 0)
    return runId
  }

  // Fire one pending completion, for the sequential-ordering test.
  flushOne(): void {
    const fire = this.pending.shift()
    fire?.()
  }

  pendingCount(): number {
    return this.pending.length
  }

  subscribe(runId: SkillRunId, listener: SkillEventListener): SkillRunSubscription {
    this.listeners.set(runId, listener)
    return {
      unsubscribe: () => this.listeners.delete(runId),
      positionAtSubscribe: 0,
    }
  }

  isActive(): boolean { return false }
  async cancel(): Promise<void> {}
  async forgetSession(): Promise<void> {}
}

class FakeSourceUnitDigest implements SourceUnitDigest {
  shaByPath = new Map<string, SourceUnitSha>()
  defaultSha: SourceUnitSha = ('a'.repeat(64)) as SourceUnitSha
  async computeSha(_workspace: unknown, _sourceId: SourceId, path: string): Promise<SourceUnitSha> {
    return this.shaByPath.get(path) ?? this.defaultSha
  }
}

async function setup(opts: {
  sources?: readonly SourceDescriptor[]
  hasPerUnit?: boolean
  hasCheckpoint?: boolean
  maxRunsPerHour?: number
} = {}) {
  resetTestIds()
  const workspaceRepo = new InMemoryWorkspaceRepository()
  const workspace = makeWorkspace({
    id: mintTestId('ws') as WorkspaceId,
    sources: opts.sources ?? [intentSource('issues')],
  })
  await workspaceRepo.save(workspace)

  const pluginRegistry = new PluginRegistry()
  const workspaceService = new WorkspaceService({ workspaceRepository: workspaceRepo, pluginRegistry })
  const batchBinding: {
    perUnit: { skillId: SkillId }
    checkpoint?: { skillId: SkillId, chunkSize: number, runAtEnd: boolean }
  } = { perUnit: { skillId: PER_UNIT_SKILL } }
  if (opts.hasCheckpoint)
    batchBinding.checkpoint = { skillId: CHECKPOINT_SKILL, chunkSize: 100, runAtEnd: true }
  await pluginRegistry.register(makeOntology({ ontologyId: 'ddd', batch: batchBinding }))

  const eventBus = new InMemoryWorkspaceEventBus()
  const clock = new FixedClock()
  const skillRunner = new FakeSkillRunner()
  const sourceUnitObservationRepository = new InMemorySourceUnitObservationRepository()
  const digest = new FakeSourceUnitDigest()
  const sourceUnitObservationService = new SourceUnitObservationService({
    repository: sourceUnitObservationRepository,
    digest,
    workspaceService,
    clock,
  })

  // Tracks captured events, so tests can assert on what the reactor emitted,
  // without subscribing to a workspace they don't have a handle on.
  const captured: WorkspaceEvent[] = []
  const originalPublish = eventBus.publish.bind(eventBus)
  eventBus.publish = (event: WorkspaceEvent): void => {
    captured.push(event)
    originalPublish(event)
  }

  // Default intentLister returns three units in source `issues`.
  let intentItems: ReadonlyArray<{ value: string, label: string, sourceId: string, sourceName: string }> = [
    { value: 'issues/1.md', label: '1', sourceId: 'issues', sourceName: 'issues' },
    { value: 'issues/2.md', label: '2', sourceId: 'issues', sourceName: 'issues' },
    { value: 'issues/3.md', label: '3', sourceId: 'issues', sourceName: 'issues' },
  ]
  const intentLister: IntentLister = async () => [...intentItems]
  function setUnits(items: typeof intentItems): void {
    intentItems = items
  }

  // Throttle limit is read at start() time, so update the workspace BEFORE constructing the reactor,
  // when a custom cap is requested.
  if (opts.maxRunsPerHour) {
    const updated = new Workspace({
      id: workspace.id,
      rootPath: workspace.rootPath,
      productManifest: {
        ...workspace.productManifest,
        reactor: { enabled: true, maxRunsPerHour: opts.maxRunsPerHour },
      },
    })
    await workspaceRepo.save(updated)
  }

  const reactorCycleRepository = new InMemoryReactorCycleRepository()
  const scheduled: Array<{ delayMs: number, run: () => void }> = []
  const scheduler = {
    schedule(delayMs: number, run: () => void) {
      const entry = { delayMs, run }
      scheduled.push(entry)
      return {
        cancel: () => {
          const index = scheduled.indexOf(entry)
          if (index >= 0)
            scheduled.splice(index, 1)
        },
      }
    },
  }
  const reactor = new ReactorService({
    eventBus,
    workspaceService,
    pluginRegistry,
    skillRunner,
    sourceUnitObservationService,
    intentLister,
    digest,
    reactorCycleRepository,
    workspaceLock: new WorkspaceLock(),
    clock,
    logger: { info() {}, warn() {}, error() {} },
    scheduler,
  })

  await reactor.start(workspace.id)

  return {
    workspace,
    reactor,
    eventBus,
    skillRunner,
    digest,
    captured,
    sourceUnitObservationService,
    reactorCycleRepository,
    setUnits,
    clock,
    scheduled,
  }
}

function emitSync(eventBus: WorkspaceEventBus, workspaceId: WorkspaceId, sourceId: string): void {
  eventBus.publish({
    type: 'source.synced',
    workspaceId,
    sourceId: sourceId as SourceId,
    changed: true,
    at: T0,
  })
}

async function tick(ms = 20): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('ReactorService', () => {
  it('dispatches one per-unit run for each of three new units, then one checkpoint', async () => {
    const { workspace, eventBus, skillRunner, captured } = await setup({ hasCheckpoint: true })
    emitSync(eventBus, workspace.id, 'issues')
    await tick(100)

    const perUnit = skillRunner.startCalls.filter(c => c.skillId === PER_UNIT_SKILL)
    const checkpoint = skillRunner.startCalls.filter(c => c.skillId === CHECKPOINT_SKILL)
    expect(perUnit).toHaveLength(3)
    expect(checkpoint).toHaveLength(1)

    const events = captured.filter(e => e.type.startsWith('reactor.'))
    expect(events.map(e => e.type)).toEqual([
      'reactor.dispatched',
      'reactor.unit.started',
      'reactor.unit.completed',
      'reactor.unit.started',
      'reactor.unit.completed',
      'reactor.unit.started',
      'reactor.unit.completed',
      'reactor.checkpoint.started',
      'reactor.checkpoint.completed',
      'reactor.completed',
    ])
    const completed = events.find(e => e.type === 'reactor.completed') as { totalUnits: number, checkpointRan: boolean }
    expect(completed.totalUnits).toBe(3)
    expect(completed.checkpointRan).toBe(true)
  })

  it('skips the checkpoint entirely when no per-unit dispatch succeeded', async () => {
    const { workspace, eventBus, skillRunner, captured } = await setup({ hasCheckpoint: true })
    skillRunner.exitCodes = [1, 1, 1]
    emitSync(eventBus, workspace.id, 'issues')
    await tick(100)

    const checkpoint = skillRunner.startCalls.filter(c => c.skillId === CHECKPOINT_SKILL)
    expect(checkpoint).toHaveLength(0)
    const checkpointEvents = captured.filter(e => e.type === 'reactor.checkpoint.started' || e.type === 'reactor.checkpoint.completed')
    expect(checkpointEvents).toHaveLength(0)
    const completed = captured.find(e => e.type === 'reactor.completed')
    expect((completed as { checkpointRan: boolean }).checkpointRan).toBe(false)
  })

  it('runs the checkpoint when SOME per-unit dispatches succeed and others fail', async () => {
    const { workspace, eventBus, skillRunner, captured } = await setup({ hasCheckpoint: true })
    // First unit fails, second succeeds, third fails, the loop must not abort on the first failure,
    // and the checkpoint must still run.
    skillRunner.exitCodes = [1, 0, 1]
    emitSync(eventBus, workspace.id, 'issues')
    await tick(100)

    const perUnit = skillRunner.startCalls.filter(c => c.skillId === PER_UNIT_SKILL)
    const checkpoint = skillRunner.startCalls.filter(c => c.skillId === CHECKPOINT_SKILL)
    expect(perUnit).toHaveLength(3)
    expect(checkpoint).toHaveLength(1)
    const completed = captured.find(e => e.type === 'reactor.completed')
    expect((completed as { checkpointRan: boolean }).checkpointRan).toBe(true)
  })

  it('runs per-unit dispatches strictly sequentially: unit 2 does not start until unit 1 finishes', async () => {
    const { workspace, eventBus, skillRunner } = await setup({ hasCheckpoint: false })
    skillRunner.controlled = true
    emitSync(eventBus, workspace.id, 'issues')
    await tick(50)
    // Only the first per-unit dispatch should have started.
    expect(skillRunner.startCalls).toHaveLength(1)
    expect(skillRunner.pendingCount()).toBe(1)
    skillRunner.flushOne()
    await tick(50)
    expect(skillRunner.startCalls).toHaveLength(2)
    skillRunner.flushOne()
    await tick(50)
    expect(skillRunner.startCalls).toHaveLength(3)
    skillRunner.flushOne()
    await tick(50)
    // All three done. No more started since there's no checkpoint here.
    expect(skillRunner.startCalls).toHaveLength(3)
  })

  it('ignores source.synced for `role: code` sources entirely', async () => {
    const { workspace, eventBus, skillRunner, captured } = await setup({
      sources: [intentSource('issues'), codeSource('repo-main')],
    })
    emitSync(eventBus, workspace.id, 'repo-main')
    await tick(50)
    expect(skillRunner.startCalls).toHaveLength(0)
    expect(captured.filter(e => e.type.startsWith('reactor.'))).toHaveLength(0)
  })

  it('throttles after maxRunsPerHour dispatches in a rolling 1h window', async () => {
    const { workspace, eventBus, digest, captured } = await setup({ maxRunsPerHour: 2 })
    // Each sync brings a "changed" sha, so the diff has something to dispatch on. Without rotating,
    // once the ledger catches up to the digest default, subsequent syncs see unchanged units and emit completed{0}.
    const shas: SourceUnitSha[] = [
      ('a'.repeat(64)) as SourceUnitSha,
      ('b'.repeat(64)) as SourceUnitSha,
      ('c'.repeat(64)) as SourceUnitSha,
    ]
    for (let i = 0; i < 3; i++) {
      digest.defaultSha = shas[i]!
      emitSync(eventBus, workspace.id, 'issues')
      await tick(120)
    }
    const dispatched = captured.filter(e => e.type === 'reactor.dispatched')
    const throttled = captured.filter(e => e.type === 'reactor.throttled')
    expect(dispatched).toHaveLength(2)
    expect(throttled).toHaveLength(1)
    expect((throttled[0] as { limit: number }).limit).toBe(2)
  })

  it('emits a completed event with totalUnits=0 when the diff has no changes', async () => {
    const { workspace, eventBus, skillRunner, captured, setUnits } = await setup()
    // No units, diff returns 0 in all partitions, reactor emits completed{0}
    setUnits([])
    emitSync(eventBus, workspace.id, 'issues')
    await tick(50)
    expect(skillRunner.startCalls).toHaveLength(0)
    const completed = captured.find(e => e.type === 'reactor.completed')
    expect((completed as { totalUnits: number, checkpointRan: boolean })).toMatchObject({
      totalUnits: 0,
      checkpointRan: false,
    })
  })

  it('stops listening when the subscription is disposed', async () => {
    const { workspace, reactor, eventBus, skillRunner: runner } = await setup()
    await reactor.stop(workspace.id)
    emitSync(eventBus, workspace.id, 'issues')
    await tick(50)
    expect(runner.startCalls).toHaveLength(0)
  })

  it('persists a ReactorCycle record with units in terminal status after a normal cycle', async () => {
    const { workspace, eventBus, reactorCycleRepository, captured } = await setup({ hasCheckpoint: true })
    emitSync(eventBus, workspace.id, 'issues')
    await tick(150)
    const passes = await reactorCycleRepository.listByWorkspace(workspace.id)
    expect(passes).toHaveLength(1)
    const cycle = passes[0]!
    expect(cycle.status).toBe('completed')
    expect(cycle.units).toHaveLength(3)
    expect(cycle.units.every(u => u.status === 'success')).toBe(true)
    expect(cycle.checkpoint?.status).toBe('success')
    // Every emitted reactor.* event refers to the same cycleId.
    const reactorEvents = captured.filter(e => e.type.startsWith('reactor.'))
    expect(reactorEvents.every((e) => {
      const eventWithCycle = e as { cycleId?: string }
      return eventWithCycle.cycleId === cycle.id
    })).toBe(true)
  })

  it('emits reactor.unit.started + reactor.unit.completed for every dispatched unit, in order', async () => {
    const { workspace, eventBus, captured } = await setup({ hasCheckpoint: true })
    emitSync(eventBus, workspace.id, 'issues')
    await tick(200)
    const unitEvents = captured.filter(e => e.type === 'reactor.unit.started' || e.type === 'reactor.unit.completed')
    expect(unitEvents.map(e => e.type)).toEqual([
      'reactor.unit.started',
      'reactor.unit.completed',
      'reactor.unit.started',
      'reactor.unit.completed',
      'reactor.unit.started',
      'reactor.unit.completed',
    ])
    const startedTotals = unitEvents.filter(e => e.type === 'reactor.unit.started').map(e => (e as { total: number }).total)
    const completedProcessed = unitEvents.filter(e => e.type === 'reactor.unit.completed').map(e => (e as { processed: number }).processed)
    expect(startedTotals).toEqual([3, 3, 3])
    expect(completedProcessed).toEqual([1, 2, 3])
  })

  it('persists a throttled cycle with status=throttled so the Activity page can surface it', async () => {
    const { workspace, eventBus, digest, reactorCycleRepository } = await setup({ maxRunsPerHour: 1 })
    const shas: SourceUnitSha[] = [
      ('a'.repeat(64)) as SourceUnitSha,
      ('b'.repeat(64)) as SourceUnitSha,
    ]
    for (let i = 0; i < 2; i++) {
      digest.defaultSha = shas[i]!
      emitSync(eventBus, workspace.id, 'issues')
      await tick(150)
    }
    const passes = await reactorCycleRepository.listByWorkspace(workspace.id)
    const throttled = passes.filter(p => p.status === 'throttled')
    expect(throttled).toHaveLength(1)
    expect(throttled[0]!.throttledReason).toBe('maxRunsPerHour=1')
  })

  it('schedules a catch-up when throttled, and it runs once a slot frees', async () => {
    const { workspace, eventBus, digest, reactorCycleRepository, skillRunner, clock, scheduled } = await setup({ maxRunsPerHour: 1 })
    // First sync spends the single hourly slot.
    digest.defaultSha = ('a'.repeat(64)) as SourceUnitSha
    emitSync(eventBus, workspace.id, 'issues')
    await tick(150)
    // Second sync changes the units again but is throttled, which schedules one retry.
    digest.defaultSha = ('b'.repeat(64)) as SourceUnitSha
    emitSync(eventBus, workspace.id, 'issues')
    await tick(150)

    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.delayMs).toBeGreaterThan(0)
    const throttledBefore = (await reactorCycleRepository.listByWorkspace(workspace.id)).filter(c => c.status === 'throttled')
    expect(throttledBefore).toHaveLength(1)

    // Advance past the rolling window so the slot frees, then fire the scheduled retry.
    clock.set(new Date(Date.parse(T0) + 60 * 60 * 1000 + 1000).toISOString() as Timestamp)
    const runsBefore = skillRunner.startCalls.length
    scheduled[0]!.run()
    await tick(150)

    // The retry re-derived the diff and processed the still-changed units.
    expect(skillRunner.startCalls.length).toBeGreaterThan(runsBefore)
    const completed = (await reactorCycleRepository.listByWorkspace(workspace.id)).filter(c => c.status === 'completed')
    expect(completed.length).toBeGreaterThan(0)
  })
})
