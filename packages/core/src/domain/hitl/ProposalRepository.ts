import type { ProposalFilter, ProposalId } from '@telos/schema'
import type { Proposal } from './Proposal.js'

export interface ProposalRepository {
  list: (filter?: ProposalFilter) => Promise<Proposal[]>
  load: (proposalId: ProposalId) => Promise<Proposal>
  save: (proposal: Proposal) => Promise<void>
  remove: (proposalId: ProposalId) => Promise<void>
}
