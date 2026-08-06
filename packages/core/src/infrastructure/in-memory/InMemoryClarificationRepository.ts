import type { ClarificationFilter, ClarificationId } from '@braidhq/schema'
import type { Clarification } from '../../domain/hitl/Clarification.js'
import type { ClarificationRepository } from '../../domain/hitl/ClarificationRepository.js'
import { paginate } from '../../domain/paginate.js'
import { InMemoryKeyedStore } from './InMemoryKeyedStore.js'

export class InMemoryClarificationRepository implements ClarificationRepository {
  private readonly store = new InMemoryKeyedStore<ClarificationId, Clarification>('Clarification')

  async list(filter?: ClarificationFilter): Promise<Clarification[]> {
    let clarifications = this.store.listAll()
    if (filter?.workspaceId !== undefined) {
      const wsId = filter.workspaceId
      clarifications = clarifications.filter(clarification => clarification.workspaceId === wsId)
    }
    if (filter?.statuses && filter.statuses.length > 0) {
      const statuses = filter.statuses
      clarifications = clarifications.filter(clarification => statuses.includes(clarification.status))
    }
    if (filter?.viewerId !== undefined) {
      const viewerId = filter.viewerId
      const includeServiceOwned = filter.includeServiceOwned ?? false
      clarifications = clarifications.filter(clarification =>
        clarification.status !== 'pending' || clarification.owner === viewerId || (includeServiceOwned && clarification.ownerKind === 'service'),
      )
    }
    return paginate(clarifications, filter?.limit, filter?.offset)
  }

  async load(clarificationId: ClarificationId): Promise<Clarification> {
    return this.store.get(clarificationId)
  }

  async save(clarification: Clarification): Promise<void> {
    this.store.set(clarification.id, clarification)
  }
}
