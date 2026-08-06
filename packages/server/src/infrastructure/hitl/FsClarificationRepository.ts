import type {
  AbsolutePath,
  ClarificationFilter,
  ClarificationId,
  WorkspaceId,
} from '@braidhq/schema'
import { Clarification, type ClarificationRepository, paginate } from '@braidhq/core'
import { Clarification as ClarificationSchema } from '@braidhq/schema'
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
    let clarifications = await this.base.list({
      ...(filter?.workspaceId !== undefined ? { workspaceId: filter.workspaceId } : {}),
      ...(filter?.statuses !== undefined ? { statuses: filter.statuses } : {}),
    })
    // Pending clarifications are personal, only the owner sees them.
    // Answered, applied, and skipped clarifications stay workspace-shared.
    if (filter?.viewerId !== undefined) {
      const viewerId = filter.viewerId
      const includeServiceOwned = filter.includeServiceOwned ?? false
      clarifications = clarifications.filter(clarification =>
        clarification.status !== 'pending' || clarification.owner === viewerId || (includeServiceOwned && clarification.ownerKind === 'service'),
      )
    }
    return paginate(clarifications, filter?.limit, filter?.offset)
  }

  load(clarificationId: ClarificationId): Promise<Clarification> {
    return this.base.load(clarificationId)
  }

  save(clarification: Clarification): Promise<void> {
    return this.base.save(clarification)
  }
}
