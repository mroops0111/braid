import type { ClarificationFilter, ClarificationId } from '@braidhq/schema'
import type { Clarification } from '../../domain/hitl/Clarification.js'
import type { ClarificationRepository } from '../../domain/hitl/ClarificationRepository.js'
import { paginate } from '../../domain/paginate.js'
import { InMemoryKeyedStore } from './InMemoryKeyedStore.js'

export class InMemoryClarificationRepository implements ClarificationRepository {
  private readonly store = new InMemoryKeyedStore<ClarificationId, Clarification>('Clarification')

  async list(filter?: ClarificationFilter): Promise<Clarification[]> {
    let tickets = this.store.listAll()
    if (filter?.workspaceId !== undefined) {
      const wsId = filter.workspaceId
      tickets = tickets.filter(ticket => ticket.workspaceId === wsId)
    }
    if (filter?.statuses && filter.statuses.length > 0) {
      const statuses = filter.statuses
      tickets = tickets.filter(ticket => statuses.includes(ticket.status))
    }
    if (filter?.viewerId !== undefined) {
      const viewerId = filter.viewerId
      tickets = tickets.filter(ticket =>
        ticket.status !== 'pending' || ticket.owner === 'system' || ticket.owner === viewerId,
      )
    }
    return paginate(tickets, filter?.limit, filter?.offset)
  }

  async load(clarificationId: ClarificationId): Promise<Clarification> {
    return this.store.get(clarificationId)
  }

  async save(ticket: Clarification): Promise<void> {
    this.store.set(ticket.id, ticket)
  }
}
