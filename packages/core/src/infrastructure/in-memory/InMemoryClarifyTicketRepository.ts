import type { ClarifyFilter, ClarifyTicketId } from '@telos/schema'
import type { ClarifyTicket } from '../../domain/hitl/ClarifyTicket.js'
import type { ClarifyTicketRepository } from '../../domain/hitl/ClarifyTicketRepository.js'
import { InMemoryKeyedStore } from './InMemoryKeyedStore.js'

export class InMemoryClarifyTicketRepository implements ClarifyTicketRepository {
  private readonly store = new InMemoryKeyedStore<ClarifyTicketId, ClarifyTicket>('ClarifyTicket')

  async list(filter?: ClarifyFilter): Promise<ClarifyTicket[]> {
    let tickets = this.store.listAll()
    if (filter?.workspaceId !== undefined) {
      const wsId = filter.workspaceId
      tickets = tickets.filter(ticket => ticket.workspaceId === wsId)
    }
    if (filter?.statuses && filter.statuses.length > 0) {
      const statuses = filter.statuses
      tickets = tickets.filter(ticket => statuses.includes(ticket.status))
    }
    return paginate(tickets, filter?.limit, filter?.offset)
  }

  async load(clarifyTicketId: ClarifyTicketId): Promise<ClarifyTicket> {
    return this.store.get(clarifyTicketId)
  }

  async save(ticket: ClarifyTicket): Promise<void> {
    this.store.set(ticket.id, ticket)
  }
}

function paginate<T>(items: readonly T[], limit?: number, offset?: number): T[] {
  const start = offset ?? 0
  const end = limit !== undefined ? start + limit : undefined
  return items.slice(start, end)
}
