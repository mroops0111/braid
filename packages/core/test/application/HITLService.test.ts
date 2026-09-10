import type {
  ClarificationCandidateId,
  NodeId,
  NodeStatus,
  NodeTypeId,
  ProposalId,
  SkillRunId,
  UserId,
  ValidationCode,
  WorkspaceId,
} from '@braidhq/schema'
import type { Workspace } from '../../src/index.js'
import { FixedClock, inertRunRepository, makeClarification, makeOntology, makeProposal, makeRunRecord, makeWorkspace, mintTestId, resetTestIds } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryClarificationRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemoryWorkspaceRepository,
} from '../../src/in-memory.js'
import {
  ConflictError,
  HITLService,
  ModelValidationService,
  NotFoundError,
  PluginRegistry,
  ValidationError,
  WorkspaceService,
} from '../../src/index.js'

const userId = 'u-1' as UserId

interface HITLFixture {
  proposalRepository: InMemoryProposalRepository
  clarificationRepository: InMemoryClarificationRepository
  modelRepository: InMemoryModelRepository
  workspaceService: WorkspaceService
  pluginRegistry: PluginRegistry
  clock: FixedClock
  workspaceId: WorkspaceId
  service: HITLService
}

async function setupFixture(options: {
  pluginRegistry?: PluginRegistry
  /** Run records the service reads to tell a watched run from an unwatched one. */
  runs?: readonly { runId: SkillRunId, unattended?: boolean }[]
} = {}): Promise<HITLFixture> {
  const workspaceRepo = new InMemoryWorkspaceRepository()
  const workspace = makeWorkspace({ id: mintTestId('ws') }) as Workspace
  await workspaceRepo.save(workspace)
  const pluginRegistry = options.pluginRegistry ?? new PluginRegistry()
  const workspaceService = new WorkspaceService({ workspaceRepository: workspaceRepo, pluginRegistry })

  const proposalRepository = new InMemoryProposalRepository()
  const clarificationRepository = new InMemoryClarificationRepository()
  const modelRepository = new InMemoryModelRepository()
  const clock = new FixedClock()
  const modelValidationService = new ModelValidationService({ pluginRegistry })

  const service = new HITLService({
    proposalRepository,
    clarificationRepository,
    modelRepository,
    modelValidationService,
    workspaceService,
    clock,
    ...(options.runs
      ? {
          runRepository: {
            ...inertRunRepository(),
            listRecords: async () => options.runs!.map(run => makeRunRecord({
              runId: run.runId,
              workspaceId: workspace.id,
              args: '',
              ...(run.unattended ? { unattended: true } : {}),
            })),
          },
        }
      : {}),
  })

  return {
    proposalRepository,
    clarificationRepository,
    modelRepository,
    workspaceService,
    pluginRegistry,
    clock,
    workspaceId: workspace.id,
    service,
  }
}

describe('runSubmissionLimits', () => {
  const RUN = 'skill-run-1' as SkillRunId

  // Checked against what the run wrote, not against anything held in memory,
  // so a restarted process cannot let the same run submit twice.
  it('refuses a second proposal from one run', async () => {
    const { service, workspaceId, proposalRepository } = await setupFixture()
    await proposalRepository.save(makeProposal(workspaceId, { id: 'p-1', skillRunId: RUN }))
    await expect(service.submitProposal({
      workspaceId,
      operations: [],
      generatedBy: 'ddd:extract' as never,
      rationale: 'second',
      skillRunId: RUN as never,
    })).rejects.toThrow(/already proposed/)
  })

  it('refuses a question from a run that already proposed', async () => {
    const { service, workspaceId, proposalRepository } = await setupFixture()
    await proposalRepository.save(makeProposal(workspaceId, { id: 'p-1', skillRunId: RUN }))
    await expect(service.submitClarification({
      workspaceId,
      question: 'which one?',
      candidates: [],
      skillRunId: RUN as never,
    })).rejects.toThrow(/cannot also ask/)
  })

  it('refuses a proposal from a run parked on a question', async () => {
    const { service, workspaceId, clarificationRepository } = await setupFixture()
    await clarificationRepository.save(
      makeClarification(workspaceId, { id: 'ct-1', skillRunId: RUN, answerMode: 'resumes' }),
    )
    await expect(service.submitProposal({
      workspaceId,
      operations: [],
      generatedBy: 'ddd:extract' as never,
      rationale: 'jumping the gun',
      skillRunId: RUN as never,
    })).rejects.toThrow(/stops here/)
  })

  // Nothing is waiting on an unattended run's question, so it never blocks.
  it('lets an unattended run propose alongside its own question', async () => {
    const { service, workspaceId } = await setupFixture({
      runs: [{ runId: RUN, unattended: true }],
    })
    const asked = await service.submitClarification({
      workspaceId,
      question: 'which one?',
      candidates: [],
      skillRunId: RUN as never,
    })
    expect(asked.answerMode).toBe('standing')
    await expect(service.submitProposal({
      workspaceId,
      operations: [],
      generatedBy: 'ddd:extract' as never,
      rationale: 'batch output',
      skillRunId: RUN as never,
    })).resolves.toBeDefined()
  })

  it('parks a watched run on its question', async () => {
    const { service, workspaceId } = await setupFixture({ runs: [{ runId: RUN }] })
    const asked = await service.submitClarification({
      workspaceId,
      question: 'which one?',
      candidates: [],
      skillRunId: RUN as never,
    })
    expect(asked.answerMode).toBe('resumes')
  })
})

describe('HITLService', () => {
  beforeEach(() => {
    resetTestIds()
  })

  describe('applyProposal', () => {
    it('applies operations to model and returns the applied proposal', async () => {
      const fixture = await setupFixture()
      const proposal = makeProposal(fixture.workspaceId)
      await fixture.proposalRepository.save(proposal)

      const applied = await fixture.service.applyProposal(proposal.id, userId)

      expect(applied.status).toBe('applied')
      expect(applied.id).toBe(proposal.id)
      expect(applied.workspaceId).toBe(fixture.workspaceId)
      expect((await fixture.modelRepository.load(fixture.workspaceId)).nodes).toHaveLength(1)
    })

    it('marks proposal as applied', async () => {
      const fixture = await setupFixture()
      const proposal = makeProposal(fixture.workspaceId)
      await fixture.proposalRepository.save(proposal)

      await fixture.service.applyProposal(proposal.id, userId)

      const reloaded = await fixture.proposalRepository.load(proposal.id)
      expect(reloaded.status).toBe('applied')
    })

    it('throws NotFoundError for unknown proposal', async () => {
      const fixture = await setupFixture()

      await expect(
        fixture.service.applyProposal('missing' as ProposalId, userId),
      ).rejects.toThrow(NotFoundError)
    })

    it('throws ConflictError when applying an already-applied proposal', async () => {
      const fixture = await setupFixture()
      const proposal = makeProposal(fixture.workspaceId)
      await fixture.proposalRepository.save(proposal)

      await fixture.service.applyProposal(proposal.id, userId)

      await expect(
        fixture.service.applyProposal(proposal.id, userId),
      ).rejects.toThrow(ConflictError)
    })

    it('closes the linked clarification when a proposal from it lands', async () => {
      const fixture = await setupFixture()
      const clarification = makeClarification(fixture.workspaceId, {
        status: 'answered',
        selectedCandidateId: mintTestId('cc') as ClarificationCandidateId,
      })
      await fixture.clarificationRepository.save(clarification)
      const proposal = makeProposal(fixture.workspaceId, { clarificationId: clarification.id })
      await fixture.proposalRepository.save(proposal)

      await fixture.service.applyProposal(proposal.id, userId)

      const reloaded = await fixture.clarificationRepository.load(clarification.id)
      expect(reloaded.status).toBe('applied')
      expect(reloaded.proposalId).toBe(proposal.id)
    })

    it('leaves a linked clarification untouched when it is not answered', async () => {
      const fixture = await setupFixture()
      const clarification = makeClarification(fixture.workspaceId)
      await fixture.clarificationRepository.save(clarification)
      const proposal = makeProposal(fixture.workspaceId, { clarificationId: clarification.id })
      await fixture.proposalRepository.save(proposal)

      await fixture.service.applyProposal(proposal.id, userId)

      const reloaded = await fixture.clarificationRepository.load(clarification.id)
      expect(reloaded.status).toBe('pending')
    })

    it('throws ValidationError when the active ontology blocks and leaves proposal pending', async () => {
      // Active ontology ships a validator that always reports an error.
      // HITLService looks up workspace.ontologyId at validate-time, and runs `ontology.validators[]`,
      // so the proposal gets rejected.
      const pluginRegistry = new PluginRegistry()
      pluginRegistry.register(makeOntology({
        ontologyId: 'ddd',
        validators: [{
          validate: async () => [
            { code: 'BRAID-BLOCK' as ValidationCode, severity: 'error', message: 'nope' },
          ],
        }],
      }))

      const fixture = await setupFixture({ pluginRegistry })
      const proposal = makeProposal(fixture.workspaceId)
      await fixture.proposalRepository.save(proposal)

      await expect(
        fixture.service.applyProposal(proposal.id, userId),
      ).rejects.toThrow(ValidationError)

      const reloaded = await fixture.proposalRepository.load(proposal.id)
      expect(reloaded.status).toBe('pending')
      expect((await fixture.modelRepository.load(fixture.workspaceId)).nodes).toEqual([])
    })

    it('serialises concurrent applyProposal calls per workspace', async () => {
      // Without per-workspace locking both calls read the same empty snapshot, both pass validation, both try to write,
      // and one surfaces a misleading "node already exists" from the store.
      // With the lock the second caller sees the proposal already applied, and gets a clean ConflictError.
      const fixture = await setupFixture()
      const proposal = makeProposal(fixture.workspaceId)
      await fixture.proposalRepository.save(proposal)

      const results = await Promise.allSettled([
        fixture.service.applyProposal(proposal.id, userId),
        fixture.service.applyProposal(proposal.id, userId),
      ])

      const fulfilled = results.filter(r => r.status === 'fulfilled')
      const rejected = results.filter(r => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError)

      const snapshot = await fixture.modelRepository.load(fixture.workspaceId)
      expect(snapshot.nodes).toHaveLength(1)
    })
  })

  describe('rejectProposal', () => {
    it('marks proposal rejected', async () => {
      const fixture = await setupFixture()
      const proposal = makeProposal(fixture.workspaceId)
      await fixture.proposalRepository.save(proposal)

      const rejected = await fixture.service.rejectProposal(
        proposal.id,
        'conflicts with existing aggregate',
        userId,
      )

      expect(rejected.status).toBe('rejected')

      const reloaded = await fixture.proposalRepository.load(proposal.id)
      expect(reloaded.status).toBe('rejected')
    })
  })

  describe('skipClarification', () => {
    it('marks clarification as skipped', async () => {
      const fixture = await setupFixture()
      const clarification = makeClarification(fixture.workspaceId)
      await fixture.clarificationRepository.save(clarification)

      const skipped = await fixture.service.skipClarification(
        clarification.id,
        'out of scope for this milestone',
        userId,
      )

      expect(skipped.status).toBe('skipped')
      const reloaded = await fixture.clarificationRepository.load(clarification.id)
      expect(reloaded.status).toBe('skipped')
    })
  })

  describe('answerClarification', () => {
    // A run often proposes new nodes and asks about them in one go, so the
    // answer fails on a node that exists only in the proposal beside it.
    it('names the pending proposal that would supply a node the answer needs', async () => {
      const fixture = await setupFixture()
      const nodeId = 'cmd.notYetApplied' as NodeId
      const otherId = mintTestId('n') as NodeId
      await fixture.modelRepository.applyOperations(fixture.workspaceId, [
        { operation: 'addNode', payload: { type: 'command' as NodeTypeId, name: 'here', id: otherId, status: 'draft' as NodeStatus } },
      ])
      await fixture.proposalRepository.save(makeProposal(fixture.workspaceId, {
        id: 'proposal-supplies-it',
        nodeId,
      }))
      const candidateId = mintTestId('cc') as ClarificationCandidateId
      const clarification = makeClarification(fixture.workspaceId, {
        candidates: [{
          id: candidateId,
          description: 'link them',
          sourceReferences: [],
          proposedOperations: [{ operation: 'removeNode', nodeId }],
        }],
      })
      await fixture.clarificationRepository.save(clarification)

      await expect(fixture.service.answerClarification({
        clarificationId: clarification.id,
        selection: { kind: 'existing', candidateId },
        userId,
      })).rejects.toThrow(/proposal-supplies-it/)
    })

    it('records the chosen candidate as answered without mutating the graph', async () => {
      // The user's answer is just a selection signal, graph writes go through the ddd:clarify skill's Proposal path,
      // not here.
      const fixture = await setupFixture()
      const nodeId = mintTestId('n') as NodeId
      await fixture.modelRepository.applyOperations(fixture.workspaceId, [
        {
          operation: 'addNode',
          payload: { type: 'command' as NodeTypeId, name: 'x', id: nodeId, status: 'draft' as NodeStatus },
        },
      ])
      const candidateId = mintTestId('cc') as ClarificationCandidateId
      const clarification = makeClarification(fixture.workspaceId, {
        candidates: [{
          id: candidateId,
          description: 'yes',
          sourceReferences: [],
          proposedOperations: [{ operation: 'removeNode', nodeId }],
        }],
      })
      await fixture.clarificationRepository.save(clarification)

      const answered = await fixture.service.answerClarification({
        clarificationId: clarification.id,
        selection: { kind: 'existing', candidateId },
        userId,
      })

      expect(answered.status).toBe('answered')
      expect(answered.workspaceId).toBe(fixture.workspaceId)
      const snapshot = await fixture.modelRepository.load(fixture.workspaceId)
      expect(snapshot.nodes).toHaveLength(1)

      const reloaded = await fixture.clarificationRepository.load(clarification.id)
      expect(reloaded.status).toBe('answered')
      expect(reloaded.selectedCandidateId).toBe(candidateId)
      expect(reloaded.resolution).toEqual([{ operation: 'removeNode', nodeId }])
    })

    it('appends a custom candidate, marks it answered, and stamps the resolution', async () => {
      // The reviewer's answer uses the same lifecycle as a skill candidate.
      // The new one shows up in the clarification's candidates with zero ops, and selectedCandidateId points at it.
      const fixture = await setupFixture()
      const clarification = makeClarification(fixture.workspaceId, {
        candidates: [{
          id: mintTestId('cc') as ClarificationCandidateId,
          description: 'pre-existing',
          sourceReferences: [],
          proposedOperations: [],
        }],
      })
      await fixture.clarificationRepository.save(clarification)

      const answered = await fixture.service.answerClarification({
        clarificationId: clarification.id,
        selection: { kind: 'custom', description: 'actually it should be hybrid' },
        userId,
      })

      expect(answered.status).toBe('answered')
      const reloaded = await fixture.clarificationRepository.load(clarification.id)
      expect(reloaded.status).toBe('answered')
      expect(reloaded.candidates).toHaveLength(2)
      const appended = reloaded.candidates[1]
      expect(appended!.description).toBe('actually it should be hybrid')
      expect(appended!.proposedOperations).toEqual([])
      expect(reloaded.selectedCandidateId).toBe(appended!.id)
      expect(reloaded.resolution).toEqual([])
    })

    it('rejects answers whose resolution ops fail validation', async () => {
      // Removing a node that doesn't exist trips the structural validator.
      // Surface the error here rather than letting the skill blow up later,
      // when it tries to wrap the failure into a Proposal.
      const fixture = await setupFixture()
      const candidateId = mintTestId('cc') as ClarificationCandidateId
      const clarification = makeClarification(fixture.workspaceId, {
        candidates: [{
          id: candidateId,
          description: 'yes',
          sourceReferences: [],
          proposedOperations: [{ operation: 'removeNode', nodeId: 'ghost' as NodeId }],
        }],
      })
      await fixture.clarificationRepository.save(clarification)

      await expect(
        fixture.service.answerClarification({
          clarificationId: clarification.id,
          selection: { kind: 'existing', candidateId },
          userId,
        }),
      ).rejects.toThrow()

      const reloaded = await fixture.clarificationRepository.load(clarification.id)
      expect(reloaded.status).toBe('pending')
    })
  })

  describe('markClarificationApplied', () => {
    it('moves an answered clarification to applied and stamps proposalId', async () => {
      const fixture = await setupFixture()
      const candidateId = mintTestId('cc') as ClarificationCandidateId
      const clarification = makeClarification(fixture.workspaceId, {
        status: 'answered',
        selectedCandidateId: candidateId,
        candidates: [{
          id: candidateId,
          description: 'a',
          sourceReferences: [],
          proposedOperations: [],
        }],
      })
      await fixture.clarificationRepository.save(clarification)
      const proposalId = mintTestId('p') as ProposalId

      const applied = await fixture.service.markClarificationApplied(clarification.id, userId, proposalId)

      expect(applied.status).toBe('applied')
      expect(applied.proposalId).toBe(proposalId)

      const reloaded = await fixture.clarificationRepository.load(clarification.id)
      expect(reloaded.status).toBe('applied')
      expect(reloaded.proposalId).toBe(proposalId)
    })

    it('moves an answered clarification to applied with no proposalId when resolution had no graph impact', async () => {
      const fixture = await setupFixture()
      const candidateId = mintTestId('cc') as ClarificationCandidateId
      const clarification = makeClarification(fixture.workspaceId, {
        status: 'answered',
        selectedCandidateId: candidateId,
        candidates: [{
          id: candidateId,
          description: 'a',
          sourceReferences: [],
          proposedOperations: [],
        }],
      })
      await fixture.clarificationRepository.save(clarification)

      const applied = await fixture.service.markClarificationApplied(clarification.id, userId)

      expect(applied.status).toBe('applied')
      expect(applied.proposalId).toBeUndefined()

      const reloaded = await fixture.clarificationRepository.load(clarification.id)
      expect(reloaded.status).toBe('applied')
      expect(reloaded.proposalId).toBeUndefined()
    })

    it('refuses to apply a clarification that has not been answered yet', async () => {
      const fixture = await setupFixture()
      const candidateId = mintTestId('cc') as ClarificationCandidateId
      const clarification = makeClarification(fixture.workspaceId, {
        candidates: [{
          id: candidateId,
          description: 'a',
          sourceReferences: [],
          proposedOperations: [],
        }],
      })
      await fixture.clarificationRepository.save(clarification)
      const proposalId = mintTestId('p') as ProposalId

      await expect(
        fixture.service.markClarificationApplied(clarification.id, userId, proposalId),
      ).rejects.toThrow(ConflictError)
    })
  })
})
