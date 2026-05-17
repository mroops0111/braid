import type {
  ClarifyCandidateId,
  ClarifyTicketId,
  NodeId,
  OntologyId,
  PluginId,
  ProposalId,
  SkillId,
  Timestamp,
  UserId,
  ValidationCode,
  WorkspaceId,
} from '@braidhq/schema'
import type {
  Workspace,
} from '../../src/index.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ClarifyTicket,
  ConflictError,
  HITLService,
  InMemoryClarifyTicketRepository,
  InMemoryDecisionRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemoryWorkspaceRepository,
  NotFoundError,
  PluginRegistry,
  Proposal,
  ValidationError,
  ValidationService,
  WorkspaceService,
} from '../../src/index.js'
import { FixedClock } from '../fakes/FixedClock.js'
import { makeWorkspace } from '../helpers/fakes.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00' as Timestamp
const workspaceId = 'ws-1' as WorkspaceId
const userId = 'u-1' as UserId

async function setupWorkspaceService(): Promise<WorkspaceService> {
  const repo = new InMemoryWorkspaceRepository()
  const ws = makeWorkspace({ id: workspaceId })
  await repo.save(ws as Workspace)
  return new WorkspaceService({ workspaceRepository: repo })
}

describe('HITLService', () => {
  let proposalRepository: InMemoryProposalRepository
  let clarifyRepository: InMemoryClarifyTicketRepository
  let decisionRepository: InMemoryDecisionRepository
  let modelRepository: InMemoryModelRepository
  let workspaceService: WorkspaceService
  let clock: FixedClock
  let service: HITLService

  beforeEach(async () => {
    proposalRepository = new InMemoryProposalRepository()
    clarifyRepository = new InMemoryClarifyTicketRepository()
    decisionRepository = new InMemoryDecisionRepository()
    modelRepository = new InMemoryModelRepository()
    clock = new FixedClock(isoTimestamp)
    workspaceService = await setupWorkspaceService()
    const validationService = new ValidationService({ pluginRegistry: new PluginRegistry() })
    service = new HITLService({
      proposalRepository,
      clarifyRepository,
      decisionRepository,
      modelRepository,
      validationService,
      workspaceService,
      clock,
    })
  })

  const seedProposal = async (id = 'p-1') => {
    const proposal = new Proposal({
      id: id as ProposalId,
      workspaceId,
      status: 'pending',
      operations: [
        {
          operation: 'addNode',
          payload: {
            type: 'command',
            name: 'voidTask',
            id: 'n-1' as NodeId,
            // implementationMissing satisfies EvidenceValidator (framework invariant):
            // intent-side proposal where code hasn't shipped yet.
            metadata: { sourceReferences: [], implementationMissing: true },
          } as never,
        },
      ],
      generatedBy: 'extract' as SkillId,
      generatedAt: isoTimestamp,
      rationale: 'r',
    })
    await proposalRepository.save(proposal)
    return proposal
  }

  describe('applyProposal', () => {
    it('applies operations to model and records decision', async () => {
      await seedProposal()
      const decision = await service.applyProposal('p-1' as ProposalId, userId)

      expect(decision.action).toBe('applyProposal')
      expect(decision.references.proposalId).toBe('p-1')
      expect(decision.workspaceId).toBe(workspaceId)
      expect((await modelRepository.load(workspaceId)).nodes).toHaveLength(1)
      expect(await decisionRepository.list()).toHaveLength(1)
    })

    it('marks proposal as applied', async () => {
      await seedProposal()
      await service.applyProposal('p-1' as ProposalId, userId)
      const reloaded = await proposalRepository.load('p-1' as ProposalId)
      expect(reloaded.status).toBe('applied')
    })

    it('throws NotFoundError for unknown proposal', async () => {
      await expect(
        service.applyProposal('missing' as ProposalId, userId),
      ).rejects.toThrow(NotFoundError)
    })

    it('throws ConflictError when applying an already-applied proposal', async () => {
      await seedProposal()
      await service.applyProposal('p-1' as ProposalId, userId)
      await expect(
        service.applyProposal('p-1' as ProposalId, userId),
      ).rejects.toThrow(ConflictError)
    })

    it('decision timestamp comes from the injected Clock', async () => {
      await seedProposal()
      const fixed = '2030-01-01T00:00:00+00:00' as Timestamp
      clock.set(fixed)
      const decision = await service.applyProposal('p-1' as ProposalId, userId)
      expect(decision.timestamp).toBe(fixed)
    })

    it('throws ValidationError when the active ontology blocks and leaves proposal pending', async () => {
      // Active ontology ships a validator that always reports an error.
      // HITLService looks up workspace.ontologyId at validate-time and
      // runs `ontology.validators[]`, so the proposal gets rejected.
      const registry = new PluginRegistry()
      registry.register({
        id: 'ontology.ddd' as PluginId,
        type: 'ontology',
        configSchema: z.object({}),
        ontologyId: 'ddd' as OntologyId,
        nodeTypes: [],
        edgeTypes: [],
        validators: [{
          validate: async () => [
            { code: 'BRAID-BLOCK' as ValidationCode, severity: 'error', message: 'nope' },
          ],
        }],
      })
      const blockingService = new HITLService({
        proposalRepository,
        clarifyRepository,
        decisionRepository,
        modelRepository,
        validationService: new ValidationService({ pluginRegistry: registry }),
        workspaceService,
        clock,
      })

      await seedProposal()
      await expect(
        blockingService.applyProposal('p-1' as ProposalId, userId),
      ).rejects.toThrow(ValidationError)

      const reloaded = await proposalRepository.load('p-1' as ProposalId)
      expect(reloaded.status).toBe('pending')
      expect((await modelRepository.load(workspaceId)).nodes).toEqual([])
    })
  })

  describe('rejectProposal', () => {
    it('marks proposal rejected and records decision', async () => {
      await seedProposal()
      const decision = await service.rejectProposal(
        'p-1' as ProposalId,
        'conflicts with existing aggregate',
        userId,
      )
      expect(decision.action).toBe('rejectProposal')
      expect(decision.rationale).toContain('conflicts')

      const reloaded = await proposalRepository.load('p-1' as ProposalId)
      expect(reloaded.status).toBe('rejected')
    })
  })

  describe('skipClarifyTicket', () => {
    it('marks ticket as skipped + records decision with rationale', async () => {
      await clarifyRepository.save(new ClarifyTicket({
        id: 'ct-1' as ClarifyTicketId,
        workspaceId,
        question: 'irrelevant?',
        candidates: [],
        status: 'pending',
      }))

      const decision = await service.skipClarifyTicket(
        'ct-1' as ClarifyTicketId,
        'out of scope for this milestone',
        userId,
      )

      expect(decision.action).toBe('skipClarifyTicket')
      expect(decision.rationale).toContain('out of scope')
      const reloaded = await clarifyRepository.load('ct-1' as ClarifyTicketId)
      expect(reloaded.status).toBe('skipped')
    })
  })

  describe('answerClarifyTicket', () => {
    it('records the chosen candidate as answered without mutating the graph', async () => {
      // The user's answer is just a selection signal: graph writes go
      // through the braid-clarify skill's Proposal path, not here.
      await modelRepository.applyOperations(workspaceId, [
        { operation: 'addNode', payload: { type: 'command', name: 'x', id: 'n-x' as NodeId } as never },
      ])

      await clarifyRepository.save(new ClarifyTicket({
        id: 'ct-1' as ClarifyTicketId,
        workspaceId,
        question: 'remove n-x?',
        candidates: [
          {
            id: 'cc-1' as ClarifyCandidateId,
            description: 'yes',
            sourceReferences: [],
            proposedOperations: [{ operation: 'removeNode', nodeId: 'n-x' as NodeId }],
          },
        ],
        status: 'pending',
      }))

      const decision = await service.answerClarifyTicket(
        'ct-1' as ClarifyTicketId,
        'cc-1' as ClarifyCandidateId,
        userId,
      )

      expect(decision.action).toBe('answerClarifyTicket')
      expect(decision.workspaceId).toBe(workspaceId)
      const snapshot = await modelRepository.load(workspaceId)
      expect(snapshot.nodes).toHaveLength(1)

      const reloaded = await clarifyRepository.load('ct-1' as ClarifyTicketId)
      expect(reloaded.status).toBe('answered')
      expect(reloaded.selectedCandidateId).toBe('cc-1')
      expect(reloaded.resolution).toEqual([{ operation: 'removeNode', nodeId: 'n-x' }])
    })

    it('rejects answers whose resolution ops fail validation', async () => {
      // Removing a node that doesn't exist trips the structural validator
      // — surface the error here rather than letting the skill blow up
      // later trying to wrap it into a Proposal.
      await clarifyRepository.save(new ClarifyTicket({
        id: 'ct-2' as ClarifyTicketId,
        workspaceId,
        question: 'remove ghost?',
        candidates: [
          {
            id: 'cc-1' as ClarifyCandidateId,
            description: 'yes',
            sourceReferences: [],
            proposedOperations: [{ operation: 'removeNode', nodeId: 'ghost' as NodeId }],
          },
        ],
        status: 'pending',
      }))

      await expect(service.answerClarifyTicket(
        'ct-2' as ClarifyTicketId,
        'cc-1' as ClarifyCandidateId,
        userId,
      )).rejects.toThrow()

      const reloaded = await clarifyRepository.load('ct-2' as ClarifyTicketId)
      expect(reloaded.status).toBe('pending')
    })
  })

  describe('linkClarifyTicketToProposal', () => {
    it('moves an answered ticket to applied and stamps proposalId', async () => {
      await clarifyRepository.save(new ClarifyTicket({
        id: 'ct-3' as ClarifyTicketId,
        workspaceId,
        question: 'q?',
        candidates: [{
          id: 'cc-1' as ClarifyCandidateId,
          description: 'a',
          sourceReferences: [],
          proposedOperations: [],
        }],
        status: 'answered',
        selectedCandidateId: 'cc-1' as ClarifyCandidateId,
        resolution: [],
        answeredBy: userId,
      }))

      const decision = await service.linkClarifyTicketToProposal(
        'ct-3' as ClarifyTicketId,
        'p-99' as ProposalId,
        userId,
      )

      expect(decision.action).toBe('applyClarifyTicket')
      expect(decision.references.proposalId).toBe('p-99')

      const reloaded = await clarifyRepository.load('ct-3' as ClarifyTicketId)
      expect(reloaded.status).toBe('applied')
      expect(reloaded.proposalId).toBe('p-99')
    })

    it('refuses to link a ticket that has not been answered yet', async () => {
      await clarifyRepository.save(new ClarifyTicket({
        id: 'ct-4' as ClarifyTicketId,
        workspaceId,
        question: 'q?',
        candidates: [{
          id: 'cc-1' as ClarifyCandidateId,
          description: 'a',
          sourceReferences: [],
          proposedOperations: [],
        }],
        status: 'pending',
      }))

      await expect(service.linkClarifyTicketToProposal(
        'ct-4' as ClarifyTicketId,
        'p-99' as ProposalId,
        userId,
      )).rejects.toThrow(ConflictError)
    })
  })
})
