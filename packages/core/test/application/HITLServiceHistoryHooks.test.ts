import type {
  ClarifyCandidateId,
  ClarifyTicketId,
  ModelSnapshot,
  NodeId,
  NodeStatus,
  NodeTypeId,
  ProposalId,
  SkillId,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import type { ModelSerializer } from '../../src/domain/model/ModelSerializer.js'
import type { Workspace } from '../../src/index.js'
import { FixedClock, makeProposal, makeWorkspace, mintTestId, resetTestIds } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryClarifyTicketRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemoryWorkspaceRepository,
} from '../../src/in-memory.js'
import {
  ClarifyTicket,
  HITLService,
  ModelValidationService,
  PluginRegistry,
  WorkspaceService,
} from '../../src/index.js'
import { SpyWorkspaceHistory } from '../helpers/doubles.js'

const userId = 'u-1' as UserId
const candidateId = 'cc-1' as ClarifyCandidateId

class SpySerializer implements ModelSerializer {
  readonly write = vi.fn(async (_workspace: Workspace, _snapshot: ModelSnapshot): Promise<void> => {})
  readonly read = vi.fn(async (): Promise<ModelSnapshot | null> => null)
  readonly exists = vi.fn(async (): Promise<boolean> => false)
}

async function setupWithHistory(options: { withHistory?: boolean } = {}) {
  const workspaceRepo = new InMemoryWorkspaceRepository()
  const workspace = makeWorkspace({ id: mintTestId('ws') }) as Workspace
  await workspaceRepo.save(workspace)
  const workspaceService = new WorkspaceService({ workspaceRepository: workspaceRepo, pluginRegistry: new PluginRegistry() })
  const proposalRepository = new InMemoryProposalRepository()
  const clarifyRepository = new InMemoryClarifyTicketRepository()
  const modelRepository = new InMemoryModelRepository()
  const clock = new FixedClock()
  const modelValidationService = new ModelValidationService({ pluginRegistry: new PluginRegistry() })

  const history = new SpyWorkspaceHistory()
  const serializer = new SpySerializer()
  const service = new HITLService({
    proposalRepository,
    clarifyRepository,
    modelRepository,
    modelValidationService,
    workspaceService,
    clock,
    ...(options.withHistory === false ? {} : { history, modelSerializer: serializer }),
  })

  return { service, history, serializer, workspaceId: workspace.id, workspace, proposalRepository, clarifyRepository, clock }
}

function makeAnsweredTicket(workspaceId: WorkspaceId): ClarifyTicket {
  return new ClarifyTicket({
    id: mintTestId('ct') as ClarifyTicketId,
    workspaceId,
    question: 'q?',
    candidates: [],
    status: 'answered',
    selectedCandidateId: candidateId,
    resolution: [],
    answeredBy: userId,
    owner: 'system',
    origin: 'skill',
  })
}

function makePendingTicket(workspaceId: WorkspaceId): ClarifyTicket {
  return new ClarifyTicket({
    id: mintTestId('ct') as ClarifyTicketId,
    workspaceId,
    question: 'q?',
    candidates: [{
      id: candidateId,
      description: 'option A',
      sourceReferences: [],
      proposedOperations: [],
    }],
    status: 'pending',
    owner: 'system',
    origin: 'skill',
  })
}

describe('HITLService — workspace history hooks', () => {
  beforeEach(() => {
    resetTestIds()
  })

  it('submitProposal commits with kind proposal-submit', async () => {
    const { service, history, workspaceId } = await setupWithHistory()
    const proposal = await service.submitProposal({
      workspaceId,
      operations: [{
        operation: 'addNode',
        payload: {
          type: 'command' as NodeTypeId,
          name: 'voidTask',
          id: mintTestId('n') as NodeId,
          status: 'draft' as NodeStatus,
          metadata: { sourceReferences: [], implementationMissing: true },
        },
      }],
      generatedBy: 'extract' as SkillId,
      rationale: 'submit smoke',
    })
    expect(history.commit).toHaveBeenCalledTimes(1)
    const message = history.commit.mock.calls[0]![1]
    expect(message.kind).toBe('proposal-submit')
    expect(message.proposalId).toBe(proposal.id)
  })

  it('submitClarifyTicket commits with kind=clarify-submit', async () => {
    const { service, history, workspaceId } = await setupWithHistory()
    const ticket = await service.submitClarifyTicket({
      workspaceId,
      question: 'agg or entity?',
      candidates: [],
    })
    expect(history.commit).toHaveBeenCalledTimes(1)
    const message = history.commit.mock.calls[0]![1]
    expect(message.kind).toBe('clarify-submit')
    expect(message.clarifyTicketId).toBe(ticket.id)
  })

  it('applyProposal serialises the post-mutation graph then commits with kind proposal-apply', async () => {
    const { service, history, serializer, workspaceId, proposalRepository } = await setupWithHistory()
    const proposal = makeProposal(workspaceId)
    await proposalRepository.save(proposal)

    await service.applyProposal(proposal.id, userId)

    expect(serializer.write).toHaveBeenCalledTimes(1)
    expect(history.commit).toHaveBeenCalledTimes(1)
    const [, message] = history.commit.mock.calls[0]!
    expect(message.kind).toBe('proposal-apply')
    expect(message.proposalId).toBe(proposal.id)
    expect(message.userId).toBe(userId)
    // Write must precede commit, so the commit's tree captures the new graph state.
    expect(serializer.write.mock.invocationCallOrder[0]!)
      .toBeLessThan(history.commit.mock.invocationCallOrder[0]!)
  })

  it('rejectProposal commits with kind=reject and skips graph serialisation', async () => {
    const { service, history, serializer, workspaceId, proposalRepository } = await setupWithHistory()
    const proposal = makeProposal(workspaceId)
    await proposalRepository.save(proposal)

    await service.rejectProposal(proposal.id, 'looks wrong', userId)

    expect(serializer.write).not.toHaveBeenCalled()
    expect(history.commit).toHaveBeenCalledTimes(1)
    expect(history.commit.mock.calls[0]![1].kind).toBe('proposal-reject')
    expect(history.commit.mock.calls[0]![1].proposalId).toBe(proposal.id)
  })

  it('answerClarifyTicket commits with kind=clarify-answer', async () => {
    const { service, history, workspaceId, clarifyRepository } = await setupWithHistory()
    const ticket = makePendingTicket(workspaceId)
    await clarifyRepository.save(ticket)

    await service.answerClarifyTicket({
      clarifyTicketId: ticket.id,
      selection: { kind: 'existing', candidateId },
      userId,
    })

    expect(history.commit).toHaveBeenCalledTimes(1)
    const message = history.commit.mock.calls[0]![1]
    expect(message.kind).toBe('clarify-answer')
    expect(message.clarifyTicketId).toBe(ticket.id)
  })

  it('markClarifyTicketApplied commits with kind=clarify-applied and stamps proposalId when present', async () => {
    const { service, history, workspaceId, clarifyRepository } = await setupWithHistory()
    const ticket = makeAnsweredTicket(workspaceId)
    await clarifyRepository.save(ticket)
    const proposalId = mintTestId('p') as ProposalId

    await service.markClarifyTicketApplied(ticket.id, userId, proposalId)

    expect(history.commit).toHaveBeenCalledTimes(1)
    const message = history.commit.mock.calls[0]![1]
    expect(message.kind).toBe('clarify-apply')
    expect(message.clarifyTicketId).toBe(ticket.id)
    expect(message.proposalId).toBe(proposalId)
  })

  it('skipClarifyTicket commits with kind=clarify-skip', async () => {
    const { service, history, workspaceId, clarifyRepository } = await setupWithHistory()
    const ticket = makePendingTicket(workspaceId)
    await clarifyRepository.save(ticket)

    await service.skipClarifyTicket(ticket.id, 'not relevant', userId)

    expect(history.commit).toHaveBeenCalledTimes(1)
    expect(history.commit.mock.calls[0]![1].kind).toBe('clarify-skip')
    expect(history.commit.mock.calls[0]![1].clarifyTicketId).toBe(ticket.id)
  })

  it('skips git hooks entirely when deps are absent (in-process / test mode)', async () => {
    const { service, history, serializer, workspaceId, proposalRepository } = await setupWithHistory({ withHistory: false })
    const proposal = makeProposal(workspaceId)
    await proposalRepository.save(proposal)

    await service.applyProposal(proposal.id, userId)
    await service.rejectProposal(makeProposal(workspaceId).id, 'r', userId)
      .catch(() => null) // second proposal not saved, ignore

    expect(history.commit).not.toHaveBeenCalled()
    expect(serializer.write).not.toHaveBeenCalled()
  })
})
