import type {
  AbsolutePath,
  ClarificationFilter,
  ClarificationId,
  WorkspaceId,
} from '@braidhq/schema'
import { Clarification, type ClarificationRepository, handoffVisibleTo, paginate } from '@braidhq/core'
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
    // Absent viewerId means no narrowing, which is what `workspace.manage` grants.
    if (filter?.viewerId !== undefined) {
      const viewerId = filter.viewerId
      clarifications = clarifications.filter(clarification => handoffVisibleTo(clarification, viewerId))
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
