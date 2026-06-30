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
  SourceUnitSha,
  TagMeta,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import type { BatchPlan, BatchPlanRepository, HistoryService, HITLService, SkillEventListener, SkillRunner, SkillRunOptions, SkillRunSubscription, SourceUnitDigest, Workspace } from '../../src/index.js'
import { SkillId as SkillIdSchema } from '@braidhq/schema'
import { FixedClock, makeOntology, makeWorkspace, mintTestId, resetTestIds, T0 } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BatchService,
  ConflictError,
  PerWorkspaceLock,
  PluginRegistry,
  Proposal,
  SourceUnitStateService,
  ValidationError,
  WorkspaceService,
} from '../../src/index.js'
import {
  InMemoryClarifyTicketRepository,
  InMemoryProposalRepository,
  InMemorySourceUnitStateRepository,
  InMemoryWorkspaceRepository,
} from '../../src/testing.js'

// Minimal fakes for the ports we need beyond the existing in-memory ones.

class FakeSkillRunner implements SkillRunner {
  readonly startCalls: Array<{ skillId: SkillId, args: string, options?: SkillRunOptions }> = []
  // Per-call exit code (default 0). Override by pushing to `exitCodes`.
  exitCodes: number[] = []
  // Hook fired AFTER start resolves, BEFORE completed event — lets tests
  // synthesise side effects (creating proposals) that the orchestrator
  // attributes to this unit via set-difference.
  onStart?: (skillId: SkillId, runId: SkillRunId) => Promise<void>

  async start(_workspace: Workspace, skillId: SkillId, args: string, options?: SkillRunOptions): Promise<SkillRunId> {
    const runId = `r-${this.startCalls.length}` as SkillRunId
    this.startCalls.push({ skillId, args, ...(options ? { options } : {}) })
    // Defer via setTimeout so the orchestrator's subsequent `subscribe`
    // registers before `completed` fires (queueMicrotask is too eager).
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

  isActive(): boolean { return false }
  async cancel(): Promise<void> {}
  async forgetSession(): Promise<void> {}
}

class InMemoryBatchPlanRepository implements BatchPlanRepository {
  private plan: BatchPlan | null = null
  async load(): Promise<BatchPlan | null> { return this.plan }
  async save(_: Workspace, plan: BatchPlan): Promise<void> { this.plan = plan }
  async clear(): Promise<void> { this.plan = null }
}

function fakeHistoryService(): HistoryService & { tagCalls: TagMeta[] } {
  const tagCalls: TagMeta[] = []
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
    createTag: vi.fn(async (_workspaceId: WorkspaceId, sha: CommitSha, name: string): Promise<TagMeta> => {
      const tag: TagMeta = { name, sha, createdAt: T0 }
      tagCalls.push(tag)
      return tag
    }),
    commitWorkspaceChange: vi.fn(async (): Promise<CommitSha> => '1'.repeat(40) as CommitSha),
    tagCalls,
  } as unknown as HistoryService & { tagCalls: TagMeta[] }
}

function fakeHitlService(): HITLService & { applyCalls: ProposalId[] } {
  const applyCalls: ProposalId[] = []
  return {
    applyProposal: vi.fn(async (proposalId: ProposalId): Promise<unknown> => {
      applyCalls.push(proposalId)
      return {}
    }),
    applyCalls,
  } as unknown as HITLService & { applyCalls: ProposalId[] }
}

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
    sources: options.sources ?? [intentSource('prd'), intentSource('design')],
  })
  await workspaceRepo.save(workspace)

  // Register a DDD-like ontology with the batch binding the production
  // ontology declares. Tests assert on the resulting skill ids.
  const pluginRegistry = new PluginRegistry()
  const workspaceService = new WorkspaceService({ workspaceRepository: workspaceRepo, pluginRegistry })

  await pluginRegistry.register(makeOntology({
    ontologyId: 'ddd',
    batch: {
      perUnit: { skillId: SkillIdSchema.parse('braid-extract') },
      checkpoint: {
        skillId: SkillIdSchema.parse('braid-model'),
        chunkSize: 5,
        runAtEnd: true,
        extraEnv: (units) => {
          const hint = units.filter(u => u.sourceId && u.scopeHint).map(u => `${u.sourceId}::${u.scopeHint}`).join('\n')
          return hint ? { BRAID_CHANGED_UNITS: hint } : {}
        },
      },
      deriveUnits: { skillId: SkillIdSchema.parse('braid-scan') },
    },
  }))

  const proposalRepository = new InMemoryProposalRepository()
  const clarifyRepository = new InMemoryClarifyTicketRepository()
  const planRepository = new InMemoryBatchPlanRepository()
  const skillRunner = new FakeSkillRunner()
  const history = fakeHistoryService()
  const hitl = fakeHitlService()
  const clock = new FixedClock()

  const sourceUnitStateRepository = new InMemorySourceUnitStateRepository()
  const sourceUnitDigest = new FakeSourceUnitDigest()
  const sourceUnitStateService = options.withObservations
    ? new SourceUnitStateService({
      repository: sourceUnitStateRepository,
      digest: sourceUnitDigest,
      workspaceService,
      clock,
    })
    : undefined

  const service = new BatchService({
    workspaceService,
    skillRunner,
    proposalRepository,
    clarifyRepository,
    historyService: history,
    hitlService: hitl,
    batchPlanRepository: planRepository,
    intentLister: async (ws) => {
      // Fake one intent item per intent source so tests can keep asserting unit count by source count.
      return ws.intentSources().map(source => ({
        value: `${source.name}/`,
        label: source.name,
        sourceId: source.id as string,
        sourceName: source.name,
      }))
    },
    workspaceLock: new PerWorkspaceLock(),
    clock,
    pluginRegistry,
    ...(sourceUnitStateService ? { sourceUnitStateService } : {}),
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
    sourceUnitStateRepository,
    sourceUnitDigest,
  }
}

async function flushBatch(planRepository: InMemoryBatchPlanRepository): Promise<BatchPlan> {
  // The run loop is fire-and-forget; poll the in-memory plan until terminal.
  for (let i = 0; i < 200; i++) {
    const plan = await planRepository.load()
    if (plan && (plan.status === 'completed' || plan.status === 'failed' || plan.status === 'stopped'))
      return plan
    await new Promise(r => setTimeout(r, 5))
  }
  throw new Error('batch never reached terminal state')
}

function freshProposal(workspaceId: WorkspaceId, id: string): Proposal {
  return new Proposal({
    id: id as ProposalId,
    workspaceId,
    status: 'pending',
    operations: [{
      operation: 'addNode',
      payload: {
        type: 'command' as never,
        name: id,
        id: id as never,
        status: 'draft' as never,
        metadata: { sourceReferences: [], implementationMissing: true },
      },
    }],
    generatedBy: 'extract' as SkillId,
    generatedAt: T0,
    rationale: 'r',
  })
}

describe('BatchService', () => {
  beforeEach(() => resetTestIds())

  it('intent mode walks one unit per intent source, completes the plan', async () => {
    const { service, workspace, proposalRepository, planRepository, skillRunner } = await setup()
    let counter = 0
    skillRunner.onStart = async () => {
      counter += 1
      await proposalRepository.save(freshProposal(workspace.id, `p-${counter}`))
    }

    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.status).toBe('completed')
    expect(final.mode).toBe('intent')
    expect(final.units).toHaveLength(2)
    expect(final.units.every(u => u.status === 'completed')).toBe(true)
    expect(skillRunner.startCalls.map(c => c.skillId)).toEqual([
      'braid-extract',
      'braid-extract',
      'braid-model',
    ])
    expect(final.units[0]!.proposalIds).toEqual(['p-1'])
    expect(final.units[1]!.proposalIds).toEqual(['p-2'])
  })

  it('autoApply forwards each fresh proposal to HITLService.applyProposal', async () => {
    const { service, workspace, proposalRepository, planRepository, skillRunner, hitl } = await setup()
    let counter = 0
    skillRunner.onStart = async () => {
      counter += 1
      await proposalRepository.save(freshProposal(workspace.id, `p-${counter}`))
    }

    await service.start(workspace.id, { autoApply: true })
    await flushBatch(planRepository)

    // 2 extracts + 1 final checkpoint = 3 skill runs, each produces a
    // fresh proposal; with autoApply on, all three get applied.
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

  it('refuses when workspace has no intent or code sources', async () => {
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

  it('chooses derive mode when no intent sources exist and runs the ontology deriveUnits skill', async () => {
    const { service, workspace, planRepository, skillRunner } = await setup({
      sources: [codeSource('codebase')],
    })
    await service.start(workspace.id, { autoApply: false })
    // The orchestrator runs the derive skill in the background; assert the kick-off and mode without driving the loop to completion.
    expect(skillRunner.startCalls[0]?.skillId).toBe('braid-scan')
    expect((await planRepository.load())?.mode).toBe('derive')
  })

  it('archive moves a completed plan to archived status', async () => {
    const { service, workspace, proposalRepository, planRepository, skillRunner } = await setup()
    skillRunner.onStart = async () => proposalRepository.save(freshProposal(workspace.id, 'p-1'))
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

  it('runs braid-model once after the extract loop and passes BRAID_CHANGED_UNITS', async () => {
    const { service, workspace, planRepository, skillRunner } = await setup()
    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.status).toBe('completed')
    const modelCalls = skillRunner.startCalls.filter(c => c.skillId === 'braid-model')
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
    expect(final.error).toMatch(/checkpoint "braid-model" failed/)
    expect(final.units.every(u => u.status === 'completed')).toBe(true)
  })

  it('records a SourceUnitState observation per completed unit when service is wired', async () => {
    const { service, workspace, planRepository, sourceUnitStateRepository, sourceUnitDigest } = await setup({ withObservations: true })
    await service.start(workspace.id, { autoApply: false })
    await flushBatch(planRepository)

    const states = await sourceUnitStateRepository.listByWorkspace(workspace.id)
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
    // Nothing to assert on the state store — the service was not wired.
  })

  it('chunks braid-model every 5 successful extracts and runs a final partial chunk', async () => {
    // 7 intent sources => 7 units => one full chunk (5) + one partial (2).
    const sources = Array.from({ length: 7 }, (_, i) => intentSource(`src-${i}`))
    const { service, workspace, planRepository, skillRunner } = await setup({ sources })

    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.status).toBe('completed')
    expect(final.units).toHaveLength(7)
    const skillIds = skillRunner.startCalls.map(c => c.skillId)
    expect(skillIds).toEqual([
      'braid-extract',
      'braid-extract',
      'braid-extract',
      'braid-extract',
      'braid-extract',
      'braid-model',
      'braid-extract',
      'braid-extract',
      'braid-model',
    ])
    expect(final.checkpointPhases).toHaveLength(2)
    expect(final.checkpointPhases[0]!.unitIds).toHaveLength(5)
    expect(final.checkpointPhases[1]!.unitIds).toHaveLength(2)
    expect(final.checkpointPhases.every(p => p.status === 'completed')).toBe(true)
  })

  it('always runs a final model pass even when chunks divide evenly', async () => {
    // Exactly 5 units = one full chunk. We still want a final model.
    const sources = Array.from({ length: 5 }, (_, i) => intentSource(`src-${i}`))
    const { service, workspace, planRepository, skillRunner } = await setup({ sources })

    await service.start(workspace.id, { autoApply: false })
    const final = await flushBatch(planRepository)

    expect(final.status).toBe('completed')
    const modelCount = skillRunner.startCalls.filter(c => c.skillId === 'braid-model').length
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
})
