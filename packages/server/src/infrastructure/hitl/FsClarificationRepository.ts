import type {
  AbsolutePath,
  ClarificationFilter,
  ClarificationId,
  WorkspaceId,
} from '@braidhq/schema'
import { Clarification, type ClarificationRepository, paginate } from '@braidhq/core'
import { Clarification as ClarificationSchema, isServiceAccount } from '@braidhq/schema'
import { clarificationDir, CLARIFY_STATUSES } from '../_shared/paths.js'
import { StatusedJsonStore } from './StatusedJsonStore.js'

export interface FsClarificationRepositoryOptions {
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

export class FsClarificationRepository implements ClarificationRepository {
  private readonly base: StatusedJsonStore<Clarification, typeof CLARIFY_STATUSES[number], ClarificationId>

  constructor(options: FsClarificationRepositoryOptions) {
    this.base = new StatusedJsonStore(
      {
        entityName: 'Clarification',
        statuses: CLARIFY_STATUSES,
        dirFor: clarificationDir,
        parse: raw => new Clarification(ClarificationSchema.parse(raw)),
        serialize: entity => entity.toData(),
        idOf: entity => entity.id,
        statusOf: entity => entity.status,
        workspaceIdOf: entity => entity.workspaceId,
      },
      options.workspaceRoots,
    )
  }

  async list(filter?: ClarificationFilter): Promise<Clarification[]> {
    let tickets = await this.base.list({
      ...(filter?.workspaceId !== undefined ? { workspaceId: filter.workspaceId } : {}),
      ...(filter?.statuses !== undefined ? { statuses: filter.statuses } : {}),
    })
    // Pending tickets are personal, only the owner sees them.
    // Answered, applied, and skipped tickets stay workspace-shared.
    if (filter?.viewerId !== undefined) {
      const viewerId = filter.viewerId
      const includeServiceAccounts = filter.includeServiceAccounts ?? false
      tickets = tickets.filter(ticket =>
        ticket.status !== 'pending' || (includeServiceAccounts && isServiceAccount(ticket.owner)) || ticket.owner === viewerId,
      )
    }
    return paginate(tickets, filter?.limit, filter?.offset)
  }

  load(clarificationId: ClarificationId): Promise<Clarification> {
    return this.base.load(clarificationId)
  }

  save(ticket: Clarification): Promise<void> {
    return this.base.save(ticket)
  }
}
