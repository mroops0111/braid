import type { AbsolutePath, ProposalFilter, ProposalId, WorkspaceId } from '@braidhq/schema'
import { paginate, Proposal, type ProposalRepository } from '@braidhq/core'
import { Proposal as ProposalSchema } from '@braidhq/schema'
import { PROPOSAL_STATUSES, proposalsDir } from './paths.js'
import { StatusedJsonStore } from './StatusedJsonStore.js'

export interface FsProposalRepositoryOptions {
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

export class FsProposalRepository implements ProposalRepository {
  private readonly base: StatusedJsonStore<Proposal, typeof PROPOSAL_STATUSES[number], ProposalId>

  constructor(options: FsProposalRepositoryOptions) {
    this.base = new StatusedJsonStore(
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
    // Pending proposals are personal, only the owner sees them.
    // Applied and rejected stay as workspace-shared audit history.
    // Absent viewerId means no filter, for Owner Show All and legacy callers.
    if (filter?.viewerId !== undefined) {
      const viewerId = filter.viewerId
      proposals = proposals.filter(proposal =>
        proposal.status !== 'pending' || proposal.owner === 'system' || proposal.owner === viewerId,
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
