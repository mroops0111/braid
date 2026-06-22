import type { AbsolutePath, SkillEvent, SkillId, SkillRunId, SourceDescriptor, SourceId, SourceUnitSha, WorkspaceId } from '@braidhq/schema'
import type {
  IntentLister,
  SkillEventListener,
  SkillRunner,
  SkillRunSubscription,
  SourceUnitDigest,
  WorkspaceEvent,
  WorkspaceEventBus,
} from '../../src/index.js'
import { SkillId as SkillIdSchema } from '@braidhq/schema'
import { FixedClock, makeOntology, makeWorkspace, mintTestId, resetTestIds, T0 } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import {
  PerWorkspaceLock,
  PluginRegistry,
  ReactorService,
  SourceUnitStateService,
  Workspace,
  WorkspaceService,
} from '../../src/index.js'
import {
  InMemorySourceUnitStateRepository,
  InMemoryWorkspaceEventBus,
  InMemoryWorkspaceRepository,
} from '../../src/testing.js'

const PER_UNIT_SKILL = SkillIdSchema.parse('braid-extract')
const CHECKPOINT_SKILL = SkillIdSchema.parse('braid-model')

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
  /** Settle the runner on `start` synchronously? Default: true (deferred via setTimeout). */
  controlled = false
  /** When `controlled` is true, stores callbacks the test triggers manually. */
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

  /** Manually flush one pending completion. Used by the sequential-ordering test. */
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
  const workspaceService = new WorkspaceService({ workspaceRepository: workspaceRepo })

  const pluginRegistry = new PluginRegistry()
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
  const sourceUnitStateRepository = new InMemorySourceUnitStateRepository()
  const digest = new FakeSourceUnitDigest()
  const sourceUnitStateService = new SourceUnitStateService({
    repository: sourceUnitStateRepository,
    digest,
    workspaceService,
    clock,
  })

  // Tracks captured events so tests can assert on what the reactor emitted
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

  // Throttle limit is read at start() time, so update the workspace
  // BEFORE constructing the reactor when a custom cap is requested.
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

  const reactor = new ReactorService({
    eventBus,
    workspaceService,
    pluginRegistry,
    skillRunner,
    sourceUnitStateService,
    intentLister,
    digest,
    workspaceLock: new PerWorkspaceLock(),
    clock,
  })

  await reactor.start(workspace.id)

  return {
    workspace,
    reactor,
    eventBus,
    skillRunner,
    digest,
    captured,
    sourceUnitStateService,
    setUnits,
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
      'reactor.completed',
    ])
    expect((events[1] as { totalUnits: number, checkpointRan: boolean }).totalUnits).toBe(3)
    expect((events[1] as { checkpointRan: boolean }).checkpointRan).toBe(true)
  })

  it('skips checkpoint when no per-unit succeeded', async () => {
    const { workspace, eventBus, skillRunner, captured } = await setup({ hasCheckpoint: true })
    skillRunner.exitCodes = [1, 1, 1]
    emitSync(eventBus, workspace.id, 'issues')
    await tick(100)

    const checkpoint = skillRunner.startCalls.filter(c => c.skillId === CHECKPOINT_SKILL)
    expect(checkpoint).toHaveLength(0)
    const completed = captured.find(e => e.type === 'reactor.completed')
    expect((completed as { checkpointRan: boolean }).checkpointRan).toBe(false)
  })

  it('runs the checkpoint when SOME per-unit dispatches succeed and others fail', async () => {
    const { workspace, eventBus, skillRunner, captured } = await setup({ hasCheckpoint: true })
    // First unit fails, second succeeds, third fails — the loop must not
    // abort on the first failure, and the checkpoint must still run.
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
    // All three done; no more started since there's no checkpoint here.
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
    // Each sync brings a "changed" sha so the diff has something to
    // dispatch on. Without rotating, after the first sync's ledger
    // writes catch up to the digest's default, subsequent syncs see
    // unchanged units and emit completed{0} instead of dispatched.
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
    // No units → diff returns 0 in all partitions → reactor emits completed{0}
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
})
