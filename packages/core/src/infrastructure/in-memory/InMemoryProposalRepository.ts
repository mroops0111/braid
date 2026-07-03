import type { ProposalFilter, ProposalId } from '@braidhq/schema'
import type { Proposal } from '../../domain/hitl/Proposal.js'
import type { ProposalRepository } from '../../domain/hitl/ProposalRepository.js'
import { paginate } from '../../domain/paginate.js'
import { InMemoryKeyedStore } from './InMemoryKeyedStore.js'

export class InMemoryProposalRepository implements ProposalRepository {
  private readonly store = new InMemoryKeyedStore<ProposalId, Proposal>('Proposal')

  async list(filter?: ProposalFilter): Promise<Proposal[]> {
    let proposals = this.store.listAll()
    if (filter?.workspaceId !== undefined) {
      const wsId = filter.workspaceId
      proposals = proposals.filter(proposal => proposal.workspaceId === wsId)
    }
    if (filter?.statuses && filter.statuses.length > 0) {
      const statuses = filter.statuses
      proposals = proposals.filter(proposal => statuses.includes(proposal.status))
    }
    if (filter?.generatedBy && filter.generatedBy.length > 0) {
      const skillIds = filter.generatedBy
      proposals = proposals.filter(proposal => skillIds.includes(proposal.generatedBy))
    }
    if (filter?.viewerId !== undefined) {
      const viewerId = filter.viewerId
      proposals = proposals.filter(proposal =>
        proposal.status !== 'pending' || proposal.owner === 'system' || proposal.owner === viewerId,
      )
    }
    return paginate(proposals, filter?.limit, filter?.offset)
  }

  async load(proposalId: ProposalId): Promise<Proposal> {
    return this.store.get(proposalId)
  }

  async save(proposal: Proposal): Promise<void> {
    this.store.set(proposal.id, proposal)
  }

  async remove(proposalId: ProposalId): Promise<void> {
    this.store.remove(proposalId)
  }
}
