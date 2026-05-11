import type { ClarifyFilter, ClarifyTicketId } from '@telos/schema'
import { type ClarifyTicket, type ClarifyTicketRepository, NotFoundError } from '../../src/index.js'

export class InMemoryClarifyTicketRepository implements ClarifyTicketRepository {
  private tickets = new Map<ClarifyTicketId, ClarifyTicket>()

  async list(filter?: ClarifyFilter): Promise<ClarifyTicket[]> {
    let entries = [...this.tickets.values()]
    if (filter?.statuses) {
      entries = entries.filter(ticket => filter.statuses!.includes(ticket.status))
    }
    return entries
  }

  async load(clarifyTicketId: ClarifyTicketId): Promise<ClarifyTicket> {
    const ticket = this.tickets.get(clarifyTicketId)
    if (!ticket)
      throw new NotFoundError(`ClarifyTicket "${clarifyTicketId}" not found`)
    return ticket
  }

  async save(ticket: ClarifyTicket): Promise<void> {
    this.tickets.set(ticket.id, ticket)
  }
}
