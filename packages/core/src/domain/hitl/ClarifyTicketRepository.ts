import type { ClarifyFilter, ClarifyTicketId } from '@telos/schema'
import type { ClarifyTicket } from './ClarifyTicket.js'

export interface ClarifyTicketRepository {
  list: (filter?: ClarifyFilter) => Promise<ClarifyTicket[]>
  load: (clarifyTicketId: ClarifyTicketId) => Promise<ClarifyTicket>
  save: (clarifyTicket: ClarifyTicket) => Promise<void>
}
