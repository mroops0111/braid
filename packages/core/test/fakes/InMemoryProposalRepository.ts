import type { ProposalFilter, ProposalId } from '@telos/schema'
import { NotFoundError, type Proposal, type ProposalRepository } from '../../src/index.js'

export class InMemoryProposalRepository implements ProposalRepository {
  private proposals = new Map<ProposalId, Proposal>()

  async list(filter?: ProposalFilter): Promise<Proposal[]> {
    let entries = [...this.proposals.values()]
    if (filter?.statuses) {
      entries = entries.filter(proposal => filter.statuses!.includes(proposal.status))
    }
    return entries
  }

  async load(proposalId: ProposalId): Promise<Proposal> {
    const proposal = this.proposals.get(proposalId)
    if (!proposal)
      throw new NotFoundError(`Proposal "${proposalId}" not found`)
    return proposal
  }

  async save(proposal: Proposal): Promise<void> {
    this.proposals.set(proposal.id, proposal)
  }

  async remove(proposalId: ProposalId): Promise<void> {
    if (!this.proposals.delete(proposalId)) {
      throw new NotFoundError(`Proposal "${proposalId}" not found`)
    }
  }
}
