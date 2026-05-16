import type { ClarifyFilter, ClarifyTicketId } from '@braidhq/schema'
import type { ClarifyTicket } from './ClarifyTicket.js'

export interface ClarifyTicketRepository {
  list: (filter?: ClarifyFilter) => Promise<ClarifyTicket[]>
  load: (clarifyTicketId: ClarifyTicketId) => Promise<ClarifyTicket>
  save: (clarifyTicket: ClarifyTicket) => Promise<void>
}
