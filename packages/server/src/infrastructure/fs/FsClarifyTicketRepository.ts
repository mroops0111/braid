import type {
  AbsolutePath,
  ClarifyFilter,
  ClarifyTicketId,
  WorkspaceId,
} from '@braidhq/schema'
import { ClarifyTicket, type ClarifyTicketRepository, paginate } from '@braidhq/core'
import { ClarifyTicket as ClarifyTicketSchema } from '@braidhq/schema'
import { FsStatusedJsonRepository } from './FsStatusedJsonRepository.js'
import { CLARIFY_STATUSES, clarifyDir } from './paths.js'

export interface FsClarifyTicketRepositoryOptions {
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

export class FsClarifyTicketRepository implements ClarifyTicketRepository {
  private readonly base: FsStatusedJsonRepository<ClarifyTicket, typeof CLARIFY_STATUSES[number], ClarifyTicketId>

  constructor(options: FsClarifyTicketRepositoryOptions) {
    this.base = new FsStatusedJsonRepository(
      {
        entityName: 'ClarifyTicket',
        statuses: CLARIFY_STATUSES,
        dirFor: clarifyDir,
        parse: raw => new ClarifyTicket(ClarifyTicketSchema.parse(raw)),
        serialize: entity => entity.toData(),
        idOf: entity => entity.id,
        statusOf: entity => entity.status,
        workspaceIdOf: entity => entity.workspaceId,
      },
      options.workspaceRoots,
    )
  }

  async list(filter?: ClarifyFilter): Promise<ClarifyTicket[]> {
    let tickets = await this.base.list({
      ...(filter?.workspaceId !== undefined ? { workspaceId: filter.workspaceId } : {}),
      ...(filter?.statuses !== undefined ? { statuses: filter.statuses } : {}),
    })
    // Phase E personal/shared filter: pending tickets only owner sees;
    // answered / applied / skipped stay workspace-shared.
    if (filter?.viewerId !== undefined) {
      const viewerId = filter.viewerId
      tickets = tickets.filter(ticket =>
        ticket.status !== 'pending' || ticket.ownerId === undefined || ticket.ownerId === viewerId,
      )
    }
    return paginate(tickets, filter?.limit, filter?.offset)
  }

  load(clarifyTicketId: ClarifyTicketId): Promise<ClarifyTicket> {
    return this.base.load(clarifyTicketId)
  }

  save(ticket: ClarifyTicket): Promise<void> {
    return this.base.save(ticket)
  }
}
