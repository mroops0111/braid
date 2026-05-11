import type {
  ClarifyCandidateId,
  ClarifyTicketId,
  NodeId,
  ProposalId,
  SkillId,
  UserId,
  WorkspaceId,
} from '@telos/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ClarifyTicket,
  HITLService,
  NotFoundError,
  Proposal,
} from '../../src/index.js'
import { InMemoryClarifyTicketRepository } from '../fakes/InMemoryClarifyTicketRepository.js'
import { InMemoryDecisionRepository } from '../fakes/InMemoryDecisionRepository.js'
import { InMemoryModelRepository } from '../fakes/InMemoryModelRepository.js'
import { InMemoryProposalRepository } from '../fakes/InMemoryProposalRepository.js'

const isoTimestamp = '2026-05-09T12:00:00+08:00'
const workspaceId = 'w-1' as WorkspaceId
const userId = 'u-1' as UserId

describe('HITLService', () => {
  let proposalRepository: InMemoryProposalRepository
  let clarifyRepository: InMemoryClarifyTicketRepository
  let decisionRepository: InMemoryDecisionRepository
  let modelRepository: InMemoryModelRepository
  let service: HITLService

  beforeEach(() => {
    proposalRepository = new InMemoryProposalRepository()
    clarifyRepository = new InMemoryClarifyTicketRepository()
    decisionRepository = new InMemoryDecisionRepository()
    modelRepository = new InMemoryModelRepository()
    service = new HITLService({
      proposalRepository,
      clarifyRepository,
      decisionRepository,
      modelRepository,
    })
  })

  const seedProposal = async (id = 'p-1') => {
    const proposal = new Proposal({
      id: id as ProposalId,
      status: 'pending',
      operations: [
        { op: 'addNode', payload: { type: 'command', name: 'voidTask', id: 'n-1' as NodeId } as never },
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
      const decision = await service.applyProposal('p-1' as ProposalId, workspaceId, userId)

      expect(decision.action).toBe('applyProposal')
      expect(decision.references.proposalId).toBe('p-1')
      expect((await modelRepository.load(workspaceId)).nodes).toHaveLength(1)
      expect(await decisionRepository.list()).toHaveLength(1)
    })

    it('marks proposal as applied', async () => {
      await seedProposal()
      await service.applyProposal('p-1' as ProposalId, workspaceId, userId)
      const reloaded = await proposalRepository.load('p-1' as ProposalId)
      expect(reloaded.status).toBe('applied')
    })

    it('throws NotFoundError for unknown proposal', async () => {
      await expect(
        service.applyProposal('missing' as ProposalId, workspaceId, userId),
      ).rejects.toThrow(NotFoundError)
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
    it('applies the selected candidate operations and records decision', async () => {
      // seed a node to be removed by candidate
      await modelRepository.applyOperations(workspaceId, [
        { op: 'addNode', payload: { type: 'command', name: 'x', id: 'n-x' as NodeId } as never },
      ])

      await clarifyRepository.save(new ClarifyTicket({
        id: 'ct-1' as ClarifyTicketId,
        question: 'remove n-x?',
        candidates: [
          {
            id: 'cc-1' as ClarifyCandidateId,
            description: 'yes',
            sourceReferences: [],
            proposedOperations: [{ op: 'removeNode', nodeId: 'n-x' as NodeId }],
          },
        ],
        status: 'pending',
      }))

      const decision = await service.answerClarifyTicket(
        'ct-1' as ClarifyTicketId,
        'cc-1' as ClarifyCandidateId,
        workspaceId,
        userId,
      )

      expect(decision.action).toBe('answerClarifyTicket')
      expect((await modelRepository.load(workspaceId)).nodes).toEqual([])

      const reloaded = await clarifyRepository.load('ct-1' as ClarifyTicketId)
      expect(reloaded.status).toBe('applied')
      expect(reloaded.selectedCandidateId).toBe('cc-1')
    })
  })
})
