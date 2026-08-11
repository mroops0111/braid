import type {
  AbsolutePath,
  CommitMeta,
  CommitSha,
  ProposalId,
  SkillEvent,
  SkillId,
  SkillRunId,
  SourceDescriptor,
  SourceId,
  SourceRole,
  SourceUnitSha,
  TagMeta,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import type { BatchPlanRepository, HistoryService, HITLService, SkillEventListener, SkillRunner, SkillRunOptions, SkillRunSubscription, SourceUnitDigest, Workspace } from '../../src/index.js'
import { BatchPlanId, BatchUnitId, SkillId as SkillIdSchema } from '@braidhq/schema'
import { FixedClock, makeOntology, makeProposal, makeWorkspace, mintTestId, resetTestIds, T0 } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryClarificationRepository,
  InMemoryProposalRepository,
  InMemorySourceUnitObservationRepository,
  InMemoryWorkspaceRepository,
} from '../../src/in-memory.js'
import {
  BatchPlan,
  BatchService,
  ConflictError,
  PluginRegistry,
  SourceUnitObservationService,
  ValidationError,
  WorkspaceLock,
  WorkspaceService,
} from '../../src/index.js'

class FakeSkillRunner implements SkillRunner {
  readonly startCalls: Array<{ skillId: SkillId, args: string, options?: SkillRunOptions }> = []
  // Per-call exit code (default 0). Override by pushing to `exitCodes`.
  exitCodes: number[] = []
  // Fires after start resolves and before the completed event.
  // Lets a test create proposals the orchestrator attributes by set difference.
  onStart?: (skillId: SkillId, runId: SkillRunId) => Promise<void>

  async start(_workspace: Workspace, skillId: SkillId, args: string, options?: SkillRunOptions): Promise<SkillRunId> {
    const runId = `r-${this.startCalls.length}` as SkillRunId
    this.startCalls.push({ skillId, args, ...(options ? { options } : {}) })
    // Defer via setTimeout so `subscribe` registers before `completed`, queueMicrotask is too eager.
    setTimeout(async () => {
      await this.onStart?.(skillId, runId)
      const listener = this.listeners.get(runId)
      const code = this.exitCodes.shift() ?? 0
      const event: SkillEvent = { type: 'completed', runId, exitCode: code, at: T0 }
      listener?.(event)
    }, 0)
    return runId
  }

  private readonly listeners = new Map<SkillRunId, SkillEventListener>()

  subscribe(runId: SkillRunId, listener: SkillEventListener): SkillRunSubscription {
    this.listeners.set(runId, listener)
    return {
      unsubscribe: () => this.listeners.delete(runId),
      positionAtSubscribe: 0,
    }
  }

  // Whether a live subprocess backs the current run, toggled per test.
  active = false
  readonly cancelCalls: SkillRunId[] = []
  isActive(_runId: SkillRunId): boolean { return this.active }
  async cancel(runId: SkillRunId): Promise<void> { this.cancelCalls.push(runId) }
  async forgetSession(): Promise<void> {}
}

class InMemoryBatchPlanRepository implements BatchPlanRepository {
  private plan: BatchPlan | null = null
  async load(): Promise<BatchPlan | null> { return this.plan }
  async save(_: Workspace, plan: BatchPlan): Promise<void> { this.plan = plan }
  async clear(): Promise<void> { this.plan = null }
}

function stubHistoryService(): HistoryService {
  return {
    listCommits: vi.fn(async (): Promise<readonly CommitMeta[]> => [{
      sha: '0'.repeat(40) as CommitSha,
      workspaceId: 'ws' as WorkspaceId,
      message: { kind: 'initial', subject: 's', userId: 'u' as UserId },
      author: { name: 'a', email: 'a@b' },
      committedAt: T0,
      parents: [],
      stats: null,
    }]),
    createTag: vi.fn(async (_workspaceId: WorkspaceId, sha: CommitSha, name: string): Promise<TagMeta> => ({ name, sha, createdAt: T0 })),
    commitWorkspaceChange: vi.fn(async (): Promise<CommitSha> => '1'.repeat(40) as CommitSha),
  } as unknown as HistoryService
}

function spyHitlService(): HITLService & { applyCalls: ProposalId[] } {
  const applyCalls: ProposalId[] = []
  return {
    applyProposal: vi.fn(async (proposalId: ProposalId): Promise<unknown> => {
      applyCalls.push(proposalId)
      return {}
    }),
    applyCalls,
  } as unknown as HITLService & { applyCalls: ProposalId[] }
}

function primarySource(id: string): SourceDescriptor {
  return {
    kind: 'filesystem',
    id: id as SourceId,
    role: 'primary' as SourceRole,
    name: id,
    path: `/abs/${id}` as AbsolutePath,
  }
}

function secondarySource(id: string): SourceDescriptor {
  return {
    kind: 'filesystem',
    id: id as SourceId,
    role: 'secondary' as SourceRole,
    name: id,
    path: `/abs/${id}` as AbsolutePath,
  }
}

class FakeSourceUnitDigest implements SourceUnitDigest {
  readonly calls: Array<{ sourceId: string, path: string }> = []
  async computeSha(_workspace: Workspace, sourceId: SourceId, path: string): Promise<SourceUnitSha> {
    this.calls.push({ sourceId, path })
    return `${'0'.repeat(63)}${(this.calls.length % 10).toString()}` as SourceUnitSha
  }
}

async function setup(options: {
  sources?: readonly SourceDescriptor[]
  autoApply?: boolean
  withObservations?: boolean
} = {}) {
  resetTestIds()
  const workspaceRepo = new InMemoryWorkspaceRepository()
  const workspace = makeWorkspace({
    id: mintTestId('ws'),
    sources: options.sources ?? [primarySource('prd'), primarySource('design')],
  })
  await workspaceRepo.save(workspace)

  // Register a DDD-like ontology, with the batch binding the production ontology declares.
  // Tests assert on the resulting skill ids.
  const pluginRegistry = new PluginRegistry()
  const workspaceService = new WorkspaceService({ workspaceRepository: workspaceRepo, pluginRegistry })

  await pluginRegistry.register(makeOntology({
    ontologyId: 'ddd',
    sourceRoles: [
      { id: 'primary', unitBearing: true },
      { id: 'secondary' },
    ],
    batch: {
      perUnit: { skillId: SkillIdSchema.parse('ddd:extract') },
      checkpoint: {
        skillId: SkillIdSchema.parse('ddd:reconcile'),
        chunkSize: 5,
        runAtEnd: true,
        extraEnv: (units) => {
          const hint = units.filter(u => u.sourceId && u.scopeHint).map(u => `${u.sourceId}::${u.scopeHint}`).join('\n')
          return hint ? { BRAID_CHANGED_UNITS: hint } : {}
        },
      },
      deriveUnits: { skillId: SkillIdSchema.parse('braid:scan') },
    },
  }))

  const proposalRepository = new InMemoryProposalRepository()
  const clarificationRepository = new InMemoryClarificationRepository()
  const planRepository = new InMemoryBatchPlanRepository()
  const skillRunner = new FakeSkillRunner()
  const history = stubHistoryService()
  const hitl = spyHitlService()
  const clock = new FixedClock()

  const sourceUnitObservationRepository = new InMemorySourceUnitObservationRepository()
  const sourceUnitDigest = new FakeSourceUnitDigest()
  const sourceUnitObservationService = options.withObservations
    ? new SourceUnitObservationService({
      repository: sourceUnitObservationRepository,
      digest: sourceUnitDigest,
      workspaceService,
      clock,
    })
    : undefined

  const service = new BatchService({
    workspaceService,
    skillRunner,
    proposalRepository,
    clarificationRepository,
    historyService: history,
    hitlService: hitl,
    batchPlanRepository: planRepository,
    unitLister: async (ws) => {
      // Fake one unit item per unit-bearing source, so tests keep asserting unit count by source count.
      return ws.sourcesWithRole('primary' as SourceRole).map(source => ({
        value: `${source.name}/`,
        label: source.name,
        sourceId: source.id as string,
        sourceName: source.name,
      }))
    },
    workspaceLock: new WorkspaceLock(),
    clock,
    pluginRegistry,
    ...(sourceUnitObservationService ? { sourceUnitObservationService } : {}),
  })

  return {
    service,
    workspace,
    proposalRepository,
    planRepository,
    skillRunner,
    history,
    hitl,
    clock,
    sourceUnitObservationRepository,
    sourceUnitDigest,
  }
}

async function flushBatch(planRepository: InMemoryBatchPlanRepository): Promise<BatchPlan> {
  // The run loop is fire-and-forget. Poll the in-memory plan until terminal.
  for (let i = 0; i < 200; i++) {
    const plan = await planRepository.load()
    if (plan && (plan.status === 'completed' || plan.status === 'failed' || plan.status === 'stopped'))
      return plan
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('batch never reached terminal state')
}

describe('BatchService', () => {
  beforeEach(() => resetTestIds())

  it('direct mode walks one unit per unit-bearing source, completes the plan', async () => {
    const { service, workspace, proposalRepository, planRepository, skillRunner } = await setup()
    let counter = 0
    skillRunner.onStart = async () => {
      counter += 1
      await proposalRepository.save(makeProposal(workspace.id, { id: `p-${counter}` }))
    }

    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.status).toBe('completed')
    expect(final.mode).toBe('direct')
    expect(final.units).toHaveLength(2)
    expect(final.units.every(u => u.status === 'completed')).toBe(true)
    expect(skillRunner.startCalls.map(c => c.skillId)).toEqual([
      'ddd:extract',
      'ddd:extract',
      'ddd:reconcile',
    ])
    expect(final.units[0]!.proposalIds).toEqual(['p-1'])
    expect(final.units[1]!.proposalIds).toEqual(['p-2'])
  })

  it('autoApply forwards each fresh proposal to HITLService.applyProposal', async () => {
    const { service, workspace, proposalRepository, planRepository, skillRunner, hitl } = await setup()
    let counter = 0
    skillRunner.onStart = async () => {
      counter += 1
      await proposalRepository.save(makeProposal(workspace.id, { id: `p-${counter}` }))
    }

    await service.start(workspace.id, { autoApply: true })
    await flushBatch(planRepository)

    // 2 extracts and 1 final checkpoint make 3 skill runs, each produces a fresh proposal. With autoApply on,
    // all three get applied.
    expect(hitl.applyCalls).toEqual(['p-1', 'p-2', 'p-3'])
  })

  it('marks a unit failed when extract exits non-zero, continues to next', async () => {
    const { service, workspace, planRepository, skillRunner } = await setup()
    skillRunner.exitCodes = [1, 0]

    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.status).toBe('completed')
    expect(final.units[0]!.status).toBe('failed')
    expect(final.units[0]!.error).toMatch(/exited with code 1/)
    expect(final.units[1]!.status).toBe('completed')
  })

  it('refuses when workspace has no sources', async () => {
    const { service, workspace } = await setup({ sources: [] })
    await expect(service.start(workspace.id, { autoApply: false })).rejects.toThrow(ValidationError)
  })

  it('refuses to start when a plan is already running', async () => {
    const { service, workspace, skillRunner, planRepository } = await setup()
    skillRunner.onStart = async () => new Promise(() => {}) // stall forever
    void service.start(workspace.id, { autoApply: false })
    // Give the loop a tick to land plan.status='running'.
    await new Promise(r => setTimeout(r, 20))
    expect((await planRepository.load())?.status).toBe('running')
    await expect(service.start(workspace.id, { autoApply: false })).rejects.toThrow(ConflictError)
  })

  it('chooses derive mode when no unit-bearing sources exist and runs the ontology deriveUnits skill', async () => {
    const { service, workspace, planRepository, skillRunner } = await setup({
      sources: [secondarySource('codebase')],
    })
    await service.start(workspace.id, { autoApply: false })
    // The orchestrator runs the derive skill in the background.
    // Assert the kick-off and mode without driving the loop to completion.
    expect(skillRunner.startCalls[0]?.skillId).toBe('braid:scan')
    expect((await planRepository.load())?.mode).toBe('derived')
  })

  it('archive moves a completed plan to archived status', async () => {
    const { service, workspace, proposalRepository, planRepository, skillRunner } = await setup()
    skillRunner.onStart = async () => proposalRepository.save(makeProposal(workspace.id, { id: 'p-1' }))
    await service.start(workspace.id, { autoApply: false })
    await flushBatch(planRepository)

    const archived = await service.archive(workspace.id)
    expect(archived.status).toBe('archived')
    expect((await planRepository.load())?.status).toBe('archived')
  })

  it('archive refuses when no plan exists', async () => {
    const { service, workspace } = await setup()
    await expect(service.archive(workspace.id)).rejects.toThrow(ValidationError)
  })

  it('runs ddd:reconcile once after the extract loop and passes BRAID_CHANGED_UNITS', async () => {
    const { service, workspace, planRepository, skillRunner } = await setup()
    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.status).toBe('completed')
    const modelCalls = skillRunner.startCalls.filter(c => c.skillId === 'ddd:reconcile')
    expect(modelCalls).toHaveLength(1)
    expect(modelCalls[0]!.args).toBe('')
    const env = modelCalls[0]!.options?.extraEnv
    expect(env).toBeDefined()
    const lines = (env!.BRAID_CHANGED_UNITS ?? '').split('\n')
    expect(lines).toHaveLength(2)
    expect(lines.every(l => /^[^:]+::[^:]+\/$/.test(l))).toBe(true)
  })

  it('marks the plan failed when the checkpoint skill exits non-zero', async () => {
    const { service, workspace, planRepository, skillRunner } = await setup()
    skillRunner.exitCodes = [0, 0, 1]
    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.status).toBe('failed')
    expect(final.error).toMatch(/checkpoint "ddd:reconcile" failed/)
    expect(final.units.every(u => u.status === 'completed')).toBe(true)
  })

  it('records a SourceUnitObservation observation per completed unit when service is wired', async () => {
    const { service, workspace, planRepository, sourceUnitObservationRepository, sourceUnitDigest } = await setup({ withObservations: true })
    await service.start(workspace.id, { autoApply: false })
    await flushBatch(planRepository)

    const states = await sourceUnitObservationRepository.listByWorkspace(workspace.id)
    expect(states).toHaveLength(2)
    const paths = states.map(s => s.path).sort()
    expect(paths).toEqual(['design/', 'prd/'])
    for (const state of states) {
      expect(state.lastObservedSha).toMatch(/^[a-f0-9]{64}$/)
      expect(state.lastObservedAt).toBe(T0)
      expect(state.lastObservedByRunId).toBeDefined()
    }
    // Digest was consulted for each extracted unit.
    expect(sourceUnitDigest.calls).toHaveLength(2)
  })

  it('does not record observations when the service is absent (in-memory composeApp default)', async () => {
    const { service, workspace, planRepository } = await setup()
    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)
    expect(final.status).toBe('completed')
    // Nothing to assert on the state store, the service was not wired.
  })

  it('chunks ddd:reconcile every 5 successful extracts and runs a final partial chunk', async () => {
    // 7 intent sources => 7 units => one full chunk (5) + one partial (2).
    const sources = Array.from({ length: 7 }, (_, i) => primarySource(`src-${i}`))
    const { service, workspace, planRepository, skillRunner } = await setup({ sources })

    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.status).toBe('completed')
    expect(final.units).toHaveLength(7)
    const skillIds = skillRunner.startCalls.map(c => c.skillId)
    expect(skillIds).toEqual([
      'ddd:extract',
      'ddd:extract',
      'ddd:extract',
      'ddd:extract',
      'ddd:extract',
      'ddd:reconcile',
      'ddd:extract',
      'ddd:extract',
      'ddd:reconcile',
    ])
    expect(final.checkpointPhases).toHaveLength(2)
    expect(final.checkpointPhases[0]!.unitIds).toHaveLength(5)
    expect(final.checkpointPhases[1]!.unitIds).toHaveLength(2)
    expect(final.checkpointPhases.every(p => p.status === 'completed')).toBe(true)
  })

  it('always runs a final model pass even when chunks divide evenly', async () => {
    // Exactly 5 units = one full chunk. We still want a final model.
    const sources = Array.from({ length: 5 }, (_, i) => primarySource(`src-${i}`))
    const { service, workspace, planRepository, skillRunner } = await setup({ sources })

    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.status).toBe('completed')
    const modelCount = skillRunner.startCalls.filter(c => c.skillId === 'ddd:reconcile').length
    expect(modelCount).toBe(2)
    expect(final.checkpointPhases).toHaveLength(2)
    expect(final.checkpointPhases[0]!.unitIds).toHaveLength(5)
    expect(final.checkpointPhases[1]!.unitIds).toHaveLength(0)
  })

  it('records checkpointPhases entries with skillRunId, startedAt, completedAt', async () => {
    const { service, workspace, planRepository } = await setup()
    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.checkpointPhases).toHaveLength(1)
    const phase = final.checkpointPhases[0]!
    expect(phase.status).toBe('completed')
    expect(phase.skillRunId).toBeDefined()
    expect(phase.startedAt).toBeDefined()
    expect(phase.completedAt).toBeDefined()
    expect(phase.unitIds).toHaveLength(2)
  })

  it('getStatus returns null before a batch and the plan once running', async () => {
    const { service, workspace, skillRunner } = await setup()
    expect(await service.getStatus(workspace.id)).toBeNull()

    skillRunner.onStart = async () => new Promise(() => {})
    void service.start(workspace.id, { autoApply: false })
    await new Promise(r => setTimeout(r, 20))

    expect((await service.getStatus(workspace.id))?.status).toBe('running')
  })

  describe('stop', () => {
    it('is a no-op when no plan exists', async () => {
      const { service, workspace } = await setup()
      await expect(service.stop(workspace.id)).resolves.toBeUndefined()
    })

    it('cancels the run when a live subprocess backs it', async () => {
      const { service, workspace, skillRunner } = await setup()
      skillRunner.active = true
      skillRunner.onStart = async () => new Promise(() => {})
      void service.start(workspace.id, { autoApply: false })
      await new Promise(r => setTimeout(r, 20))

      await service.stop(workspace.id)

      expect(skillRunner.cancelCalls).toHaveLength(1)
    })

    it('fails the plan inline when the run id is orphaned', async () => {
      const { service, workspace, skillRunner, planRepository } = await setup()
      skillRunner.active = false
      skillRunner.onStart = async () => new Promise(() => {})
      void service.start(workspace.id, { autoApply: false })
      await new Promise(r => setTimeout(r, 20))

      await service.stop(workspace.id)

      expect((await planRepository.load())?.status).toBe('failed')
    })
  })

  describe('reconcileAfterBoot', () => {
    it('is a no-op when there is no plan', async () => {
      const { service, workspace, planRepository } = await setup()
      await service.reconcileAfterBoot(workspace.id)
      expect(await planRepository.load()).toBeNull()
    })

    it('leaves a terminal plan untouched', async () => {
      const { service, workspace, proposalRepository, planRepository, skillRunner } = await setup()
      skillRunner.onStart = async () => proposalRepository.save(makeProposal(workspace.id, { id: 'p-1' }))
      await service.start(workspace.id, { autoApply: false })
      await flushBatch(planRepository)

      await service.reconcileAfterBoot(workspace.id)

      expect((await planRepository.load())?.status).toBe('completed')
    })

    it('fails a running plan whose run is no longer active', async () => {
      const { service, workspace, skillRunner, planRepository } = await setup()
      skillRunner.active = false
      skillRunner.onStart = async () => new Promise(() => {})
      void service.start(workspace.id, { autoApply: false })
      await new Promise(r => setTimeout(r, 20))

      await service.reconcileAfterBoot(workspace.id)

      expect((await planRepository.load())?.status).toBe('failed')
    })
  })

  describe('resume', () => {
    it('throws when there is no plan to resume', async () => {
      const { service, workspace } = await setup()
      await expect(service.resume(workspace.id)).rejects.toThrow(ValidationError)
    })

    it('re-runs a failed plan, skipping already-completed units', async () => {
      const { service, workspace, proposalRepository, planRepository, skillRunner } = await setup()
      // First pass fails the checkpoint, so every unit completes but the plan lands failed.
      skillRunner.exitCodes = [0, 0, 1]
      skillRunner.onStart = async () => proposalRepository.save(makeProposal(workspace.id, { id: `p-${skillRunner.startCalls.length}` }))
      await service.start(workspace.id, { autoApply: false })
      expect((await flushBatch(planRepository)).status).toBe('failed')

      await service.resume(workspace.id)
      const final = await flushBatch(planRepository)

      expect(final.status).toBe('completed')
      expect(final.units.every(u => u.status === 'completed')).toBe(true)
    })

    it('re-runs the pending units of a derived plan without re-deriving', async () => {
      const { service, workspace, planRepository, skillRunner } = await setup({
        sources: [secondarySource('codebase')],
      })
      // A derived plan that already carries units, one done, one still to run.
      // Resume must feed the pending unit straight into extract, not re-scan.
      const failedPlan = new BatchPlan({
        id: BatchPlanId.parse('batch-plan-derived'),
        workspaceId: workspace.id,
        createdAt: T0,
        updatedAt: T0,
        mode: 'derived',
        status: 'failed',
        autoApply: false,
        units: [
          { id: BatchUnitId.parse('batch-unit-orders'), name: 'orders', description: '', status: 'completed', proposalIds: [], clarificationIds: [] },
          { id: BatchUnitId.parse('batch-unit-payments'), name: 'payments', description: '', status: 'failed', proposalIds: [], clarificationIds: [], error: 'boom' },
        ],
        checkpointPhases: [],
      })
      await planRepository.save(workspace, failedPlan)

      await service.resume(workspace.id)
      const final = await flushBatch(planRepository)

      expect(final.status).toBe('completed')
      const skillIds = skillRunner.startCalls.map(c => c.skillId)
      // The D fix, resume of a derived plan must not re-derive its units.
      expect(skillIds).not.toContain('braid:scan')
      // The pending unit still re-runs.
      // Skip-completed accounting is the sibling resume test's concern,
      // so only assert extraction happened.
      expect(skillIds).toContain('ddd:extract')
    })
  })
})
