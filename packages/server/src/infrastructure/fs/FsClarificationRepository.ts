import type {
  AbsolutePath,
  ClarificationFilter,
  ClarificationId,
  WorkspaceId,
} from '@braidhq/schema'
import { Clarification, type ClarificationRepository, paginate } from '@braidhq/core'
import { Clarification as ClarificationSchema } from '@braidhq/schema'
import { FsStatusedJsonRepository } from './FsStatusedJsonRepository.js'
import { clarificationDir, CLARIFY_STATUSES } from './paths.js'

export interface FsClarificationRepositoryOptions {
  readonly workspaceRoots: () => Promise<ReadonlyMap<WorkspaceId, AbsolutePath>>
}

export class FsClarificationRepository implements ClarificationRepository {
  private readonly base: FsStatusedJsonRepository<Clarification, typeof CLARIFY_STATUSES[number], ClarificationId>

  constructor(options: FsClarificationRepositoryOptions) {
    this.base = new FsStatusedJsonRepository(
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
      tickets = tickets.filter(ticket =>
        ticket.status !== 'pending' || ticket.owner === 'system' || ticket.owner === viewerId,
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
