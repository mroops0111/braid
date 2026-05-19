import type {
  ClarifyCandidate,
  ClarifyCandidateId,
  ClarifyTicketId,
  NodeId,
  NodeStatus,
  NodeTypeId,
  ProposalId,
  SkillId,
  UserId,
  ValidationCode,
  WorkspaceId,
} from '@braidhq/schema'
import type { Workspace } from '../../src/index.js'
import { at, FixedClock, makeOntology, makeWorkspace, mintTestId, resetTestIds, T0 } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
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

const userId = 'u-1' as UserId

interface HITLFixture {
  proposalRepository: InMemoryProposalRepository
  clarifyRepository: InMemoryClarifyTicketRepository
  decisionRepository: InMemoryDecisionRepository
  modelRepository: InMemoryModelRepository
  workspaceService: WorkspaceService
  pluginRegistry: PluginRegistry
  clock: FixedClock
  workspaceId: WorkspaceId
  service: HITLService
}

async function setupFixture(options: {
  pluginRegistry?: PluginRegistry
} = {}): Promise<HITLFixture> {
  const workspaceRepo = new InMemoryWorkspaceRepository()
  const workspace = makeWorkspace({ id: mintTestId('ws') }) as Workspace
  await workspaceRepo.save(workspace)
  const workspaceService = new WorkspaceService({ workspaceRepository: workspaceRepo })

  const pluginRegistry = options.pluginRegistry ?? new PluginRegistry()
  const proposalRepository = new InMemoryProposalRepository()
  const clarifyRepository = new InMemoryClarifyTicketRepository()
  const decisionRepository = new InMemoryDecisionRepository()
  const modelRepository = new InMemoryModelRepository()
  const clock = new FixedClock()
  const validationService = new ValidationService({ pluginRegistry })

  const service = new HITLService({
    proposalRepository,
    clarifyRepository,
    decisionRepository,
    modelRepository,
    validationService,
    workspaceService,
    clock,
  })

  return {
    proposalRepository,
    clarifyRepository,
    decisionRepository,
    modelRepository,
    workspaceService,
    pluginRegistry,
    clock,
    workspaceId: workspace.id,
    service,
  }
}

function makeProposal(workspaceId: WorkspaceId, overrides: { id?: ProposalId } = {}): Proposal {
  return new Proposal({
    id: overrides.id ?? (mintTestId('p') as ProposalId),
    workspaceId,
    status: 'pending',
    operations: [{
      operation: 'addNode',
      payload: {
        type: 'command' as NodeTypeId,
        name: 'voidTask',
        id: mintTestId('n') as NodeId,
        status: 'draft' as NodeStatus,
        // implementationMissing satisfies EvidenceValidator (framework invariant):
        // intent-side proposal where code hasn't shipped yet.
        metadata: { sourceReferences: [], implementationMissing: true },
      },
    }],
    generatedBy: 'extract' as SkillId,
    generatedAt: T0,
    rationale: 'add voidTask',
  })
}

function makeClarifyTicket(workspaceId: WorkspaceId, overrides: {
  id?: ClarifyTicketId
  status?: 'pending' | 'answered'
  candidates?: readonly ClarifyCandidate[]
  selectedCandidateId?: ClarifyCandidateId
} = {}): ClarifyTicket {
  const status = overrides.status ?? 'pending'
  return new ClarifyTicket({
    id: overrides.id ?? (mintTestId('ct') as ClarifyTicketId),
    workspaceId,
    question: 'q?',
    candidates: [...(overrides.candidates ?? [])],
    status,
    ...(status === 'answered' && overrides.selectedCandidateId
      ? {
          selectedCandidateId: overrides.selectedCandidateId,
          resolution: [],
          answeredBy: userId,
        }
      : {}),
  })
}

describe('HITLService', () => {
  beforeEach(() => {
    resetTestIds()
  })

  describe('applyProposal', () => {
    it('applies operations to model and records decision', async () => {
      const fixture = await setupFixture()
      const proposal = makeProposal(fixture.workspaceId)
      await fixture.proposalRepository.save(proposal)

      const decision = await fixture.service.applyProposal(proposal.id, userId)

      expect(decision.action).toBe('applyProposal')
      expect(decision.references.proposalId).toBe(proposal.id)
      expect(decision.workspaceId).toBe(fixture.workspaceId)
      expect((await fixture.modelRepository.load(fixture.workspaceId)).nodes).toHaveLength(1)
      expect(await fixture.decisionRepository.list()).toHaveLength(1)
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

    it('records the decision with the clock-injected timestamp', async () => {
      const fixture = await setupFixture()
      const proposal = makeProposal(fixture.workspaceId)
      await fixture.proposalRepository.save(proposal)

      fixture.clock.set(at(3600))
      const decision = await fixture.service.applyProposal(proposal.id, userId)

      expect(decision.timestamp).toBe(at(3600))
    })

    it('throws ValidationError when the active ontology blocks and leaves proposal pending', async () => {
      // Active ontology ships a validator that always reports an error.
      // HITLService looks up workspace.ontologyId at validate-time and
      // runs `ontology.validators[]`, so the proposal gets rejected.
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
  })

  describe('rejectProposal', () => {
    it('marks proposal rejected and records decision', async () => {
      const fixture = await setupFixture()
      const proposal = makeProposal(fixture.workspaceId)
      await fixture.proposalRepository.save(proposal)

      const decision = await fixture.service.rejectProposal(
        proposal.id,
        'conflicts with existing aggregate',
        userId,
      )

      expect(decision.action).toBe('rejectProposal')
      expect(decision.rationale).toContain('conflicts')

      const reloaded = await fixture.proposalRepository.load(proposal.id)
      expect(reloaded.status).toBe('rejected')
    })
  })

  describe('skipClarifyTicket', () => {
    it('marks ticket as skipped + records decision with rationale', async () => {
      const fixture = await setupFixture()
      const ticket = makeClarifyTicket(fixture.workspaceId)
      await fixture.clarifyRepository.save(ticket)

      const decision = await fixture.service.skipClarifyTicket(
        ticket.id,
        'out of scope for this milestone',
        userId,
      )

      expect(decision.action).toBe('skipClarifyTicket')
      expect(decision.rationale).toContain('out of scope')
      const reloaded = await fixture.clarifyRepository.load(ticket.id)
      expect(reloaded.status).toBe('skipped')
    })
  })

  describe('answerClarifyTicket', () => {
    it('records the chosen candidate as answered without mutating the graph', async () => {
      // The user's answer is just a selection signal: graph writes go
      // through the braid-clarify skill's Proposal path, not here.
      const fixture = await setupFixture()
      const nodeId = mintTestId('n') as NodeId
      await fixture.modelRepository.applyOperations(fixture.workspaceId, [
        {
          operation: 'addNode',
          payload: { type: 'command' as NodeTypeId, name: 'x', id: nodeId, status: 'draft' as NodeStatus },
        },
      ])
      const candidateId = mintTestId('cc') as ClarifyCandidateId
      const ticket = makeClarifyTicket(fixture.workspaceId, {
        candidates: [{
          id: candidateId,
          description: 'yes',
          sourceReferences: [],
          proposedOperations: [{ operation: 'removeNode', nodeId }],
        }],
      })
      await fixture.clarifyRepository.save(ticket)

      const decision = await fixture.service.answerClarifyTicket(ticket.id, candidateId, userId)

      expect(decision.action).toBe('answerClarifyTicket')
      expect(decision.workspaceId).toBe(fixture.workspaceId)
      const snapshot = await fixture.modelRepository.load(fixture.workspaceId)
      expect(snapshot.nodes).toHaveLength(1)

      const reloaded = await fixture.clarifyRepository.load(ticket.id)
      expect(reloaded.status).toBe('answered')
      expect(reloaded.selectedCandidateId).toBe(candidateId)
      expect(reloaded.resolution).toEqual([{ operation: 'removeNode', nodeId }])
    })

    it('rejects answers whose resolution ops fail validation', async () => {
      // Removing a node that doesn't exist trips the structural validator
      // — surface the error here rather than letting the skill blow up
      // later trying to wrap it into a Proposal.
      const fixture = await setupFixture()
      const candidateId = mintTestId('cc') as ClarifyCandidateId
      const ticket = makeClarifyTicket(fixture.workspaceId, {
        candidates: [{
          id: candidateId,
          description: 'yes',
          sourceReferences: [],
          proposedOperations: [{ operation: 'removeNode', nodeId: 'ghost' as NodeId }],
        }],
      })
      await fixture.clarifyRepository.save(ticket)

      await expect(
        fixture.service.answerClarifyTicket(ticket.id, candidateId, userId),
      ).rejects.toThrow()

      const reloaded = await fixture.clarifyRepository.load(ticket.id)
      expect(reloaded.status).toBe('pending')
    })
  })

  describe('linkClarifyTicketToProposal', () => {
    it('moves an answered ticket to applied and stamps proposalId', async () => {
      const fixture = await setupFixture()
      const candidateId = mintTestId('cc') as ClarifyCandidateId
      const ticket = makeClarifyTicket(fixture.workspaceId, {
        status: 'answered',
        selectedCandidateId: candidateId,
        candidates: [{
          id: candidateId,
          description: 'a',
          sourceReferences: [],
          proposedOperations: [],
        }],
      })
      await fixture.clarifyRepository.save(ticket)
      const proposalId = mintTestId('p') as ProposalId

      const decision = await fixture.service.linkClarifyTicketToProposal(ticket.id, proposalId, userId)

      expect(decision.action).toBe('applyClarifyTicket')
      expect(decision.references.proposalId).toBe(proposalId)

      const reloaded = await fixture.clarifyRepository.load(ticket.id)
      expect(reloaded.status).toBe('applied')
      expect(reloaded.proposalId).toBe(proposalId)
    })

    it('refuses to link a ticket that has not been answered yet', async () => {
      const fixture = await setupFixture()
      const candidateId = mintTestId('cc') as ClarifyCandidateId
      const ticket = makeClarifyTicket(fixture.workspaceId, {
        candidates: [{
          id: candidateId,
          description: 'a',
          sourceReferences: [],
          proposedOperations: [],
        }],
      })
      await fixture.clarifyRepository.save(ticket)
      const proposalId = mintTestId('p') as ProposalId

      await expect(
        fixture.service.linkClarifyTicketToProposal(ticket.id, proposalId, userId),
      ).rejects.toThrow(ConflictError)
    })
  })
})
