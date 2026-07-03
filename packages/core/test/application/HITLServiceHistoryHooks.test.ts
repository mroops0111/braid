import type {
  ClarifyTicketId,
  CommitMessage,
  CommitMeta,
  CommitSha,
  FileDiff,
  ModelSnapshot,
  NodeId,
  NodeStatus,
  NodeTypeId,
  ProposalId,
  SkillId,
  TagMeta,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import type { GraphSerializer } from '../../src/domain/model/GraphSerializer.js'
import type { ListCommitsOptions, Workspace, WorkspaceHistory } from '../../src/index.js'
import { FixedClock, makeWorkspace, mintTestId, resetTestIds, T0 } from '@braidhq/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClarifyTicket,
  HITLService,
  PluginRegistry,
  Proposal,
  ValidationService,
  WorkspaceService,
} from '../../src/index.js'
import {
  InMemoryClarifyTicketRepository,
  InMemoryModelRepository,
  InMemoryProposalRepository,
  InMemoryWorkspaceRepository,
} from '../../src/testing.js'

const userId = 'u-1' as UserId

class SpyHistory implements WorkspaceHistory {
  readonly commit = vi.fn(async (_workspace: Workspace, _message: CommitMessage): Promise<CommitSha> => '0'.repeat(40) as CommitSha)
  readonly ensureInitialised = vi.fn(async (): Promise<void> => {})
  readonly listCommits = vi.fn(async (_ws: Workspace, _opts?: ListCommitsOptions): Promise<readonly CommitMeta[]> => [])
  readonly getCommit = vi.fn(async (): Promise<CommitMeta | null> => null)
  readonly getCommitDiff = vi.fn(async (): Promise<readonly FileDiff[]> => [])
  readonly readGraphAtCommit = vi.fn(async (): Promise<ModelSnapshot> => ({ nodes: [], edges: [] }))
  readonly restore = vi.fn(async (): Promise<CommitSha> => '0'.repeat(40) as CommitSha)
  readonly tag = vi.fn(async (): Promise<TagMeta> => ({ name: '', sha: '0'.repeat(40) as CommitSha, createdAt: T0 }))
  readonly listTags = vi.fn(async (): Promise<readonly TagMeta[]> => [])
  readonly deleteTag = vi.fn(async (): Promise<void> => {})
}

class SpySerializer implements GraphSerializer {
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
  const validationService = new ValidationService({ pluginRegistry: new PluginRegistry() })

  const history = new SpyHistory()
  const serializer = new SpySerializer()
  const service = new HITLService({
    proposalRepository,
    clarifyRepository,
    modelRepository,
    validationService,
    workspaceService,
    clock,
    ...(options.withHistory === false ? {} : { history, graphSerializer: serializer }),
  })

  return { service, history, serializer, workspaceId: workspace.id, workspace, proposalRepository, clarifyRepository, clock }
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
        metadata: { sourceReferences: [], implementationMissing: true },
      },
    }],
    generatedBy: 'extract' as SkillId,
    generatedAt: T0,
    rationale: 'add voidTask',
    owner: 'system',
  })
}

function makeAnsweredTicket(workspaceId: WorkspaceId): ClarifyTicket {
  return new ClarifyTicket({
    id: mintTestId('ct') as ClarifyTicketId,
    workspaceId,
    question: 'q?',
    candidates: [],
    status: 'answered',
    selectedCandidateId: 'cc-1' as never,
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
      id: 'cc-1' as never,
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

  it('submitProposal commits with kind=proposal-submit so the artefact is visible to collaborators', async () => {
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

  it('applyProposal serialises the post-mutation graph then commits with kind=apply', async () => {
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
    // Write must precede commit so the commit's tree captures the new
    // graph state.
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
      selection: { kind: 'existing', candidateId: 'cc-1' as never },
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
