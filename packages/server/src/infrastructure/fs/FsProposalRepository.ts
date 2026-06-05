import type { AbsolutePath, ProposalFilter, ProposalId, WorkspaceId } from '@braidhq/schema'
import { paginate, Proposal, type ProposalRepository } from '@braidhq/core'
import { Proposal as ProposalSchema } from '@braidhq/schema'
import { FsStatusedJsonRepository } from './FsStatusedJsonRepository.js'
import { PROPOSAL_STATUSES, proposalsDir } from './paths.js'

export interface FsProposalRepositoryOptions {
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

export class FsProposalRepository implements ProposalRepository {
  private readonly base: FsStatusedJsonRepository<Proposal, typeof PROPOSAL_STATUSES[number], ProposalId>

  constructor(options: FsProposalRepositoryOptions) {
    this.base = new FsStatusedJsonRepository(
      {
        entityName: 'Proposal',
        statuses: PROPOSAL_STATUSES,
        dirFor: proposalsDir,
        parse: raw => new Proposal(ProposalSchema.parse(raw)),
        serialize: entity => entity.toData(),
        idOf: entity => entity.id,
        statusOf: entity => entity.status,
        workspaceIdOf: entity => entity.workspaceId,
      },
      options.workspaceRoots,
    )
  }

  async list(filter?: ProposalFilter): Promise<Proposal[]> {
    let proposals = await this.base.list({
      ...(filter?.workspaceId !== undefined ? { workspaceId: filter.workspaceId } : {}),
      ...(filter?.statuses !== undefined ? { statuses: filter.statuses } : {}),
    })
    if (filter?.generatedBy && filter.generatedBy.length > 0) {
      const skills = filter.generatedBy
      proposals = proposals.filter(proposal => skills.includes(proposal.generatedBy))
    }
    // Phase E personal/shared filter: pending proposals only the
    // owner sees; applied / rejected stay workspace-shared audit
    // history. Absent viewerId means "no filter" (Owner Show All,
    // legacy callers, bootstrap).
    if (filter?.viewerId !== undefined) {
      const viewerId = filter.viewerId
      proposals = proposals.filter(proposal =>
        proposal.status !== 'pending' || proposal.ownerId === undefined || proposal.ownerId === viewerId,
      )
    }
    return paginate(proposals, filter?.limit, filter?.offset)
  }

  load(proposalId: ProposalId): Promise<Proposal> {
    return this.base.load(proposalId)
  }

  save(proposal: Proposal): Promise<void> {
    return this.base.save(proposal)
  }

  remove(proposalId: ProposalId): Promise<void> {
    return this.base.remove(proposalId)
  }
}
