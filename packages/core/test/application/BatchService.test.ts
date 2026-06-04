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
  TagMeta,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import type { BatchPlan, BatchPlanRepository, HistoryService, HITLService, SkillEventListener, SkillRunner, SkillRunSubscription, Workspace } from '../../src/index.js'
import { FixedClock, makeWorkspace, mintTestId, resetTestIds, T0 } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BatchService,
  ConflictError,
  InMemoryClarifyTicketRepository,
  InMemoryProposalRepository,
  InMemoryWorkspaceRepository,
  PerWorkspaceLock,
  Proposal,
  ValidationError,
  WorkspaceService,
} from '../../src/index.js'

// Minimal fakes for the ports we need beyond the existing in-memory ones.

class FakeSkillRunner implements SkillRunner {
  readonly startCalls: Array<{ skillId: SkillId, args: string }> = []
  // Per-call exit code (default 0). Override by pushing to `exitCodes`.
  exitCodes: number[] = []
  // Hook fired AFTER start resolves, BEFORE completed event — lets tests
  // synthesise side effects (creating proposals) that the orchestrator
  // attributes to this unit via set-difference.
  onStart?: (skillId: SkillId, runId: SkillRunId) => Promise<void>

  async start(_workspace: Workspace, skillId: SkillId, args: string): Promise<SkillRunId> {
    const runId = `r-${this.startCalls.length}` as SkillRunId
    this.startCalls.push({ skillId, args })
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

async function setup(options: {
  sources?: readonly SourceDescriptor[]
  autoApply?: boolean
} = {}) {
  resetTestIds()
  const workspaceRepo = new InMemoryWorkspaceRepository()
  const workspace = makeWorkspace({
    id: mintTestId('ws'),
    sources: options.sources ?? [intentSource('prd'), intentSource('design')],
  })
  await workspaceRepo.save(workspace)
  const workspaceService = new WorkspaceService({ workspaceRepository: workspaceRepo })

  const proposalRepository = new InMemoryProposalRepository()
  const clarifyRepository = new InMemoryClarifyTicketRepository()
  const planRepository = new InMemoryBatchPlanRepository()
  const skillRunner = new FakeSkillRunner()
  const history = fakeHistoryService()
  const hitl = fakeHitlService()
  const clock = new FixedClock()

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
  })

  return { service, workspace, proposalRepository, planRepository, skillRunner, history, hitl, clock }
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
    expect(skillRunner.startCalls.map(c => c.skillId)).toEqual(['braid-extract', 'braid-extract'])
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

    expect(hitl.applyCalls).toEqual(['p-1', 'p-2'])
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

  it('chooses scan mode when no intent sources exist', async () => {
    const { service, workspace, planRepository, skillRunner } = await setup({
      sources: [codeSource('codebase')],
    })
    await service.start(workspace.id, { autoApply: false })
    // The orchestrator runs scan in the background; assert the kick-off and mode without driving the loop to completion.
    expect(skillRunner.startCalls[0]?.skillId).toBe('braid-scan')
    expect((await planRepository.load())?.mode).toBe('scan')
  })
})
