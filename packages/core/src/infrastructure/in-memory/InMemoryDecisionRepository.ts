import type { Decision, DecisionFilter, DecisionId } from '@braidhq/schema'
import type { DecisionRepository } from '../../domain/hitl/DecisionRepository.js'
import { NotFoundError } from '../../domain/errors.js'

export class InMemoryDecisionRepository implements DecisionRepository {
  private readonly decisions: Decision[] = []

  async append(decision: Decision): Promise<void> {
    this.decisions.push(decision)
  }

  async list(filter?: DecisionFilter): Promise<Decision[]> {
    let decisions = [...this.decisions]
    if (filter?.workspaceId !== undefined) {
      const wsId = filter.workspaceId
      decisions = decisions.filter(decision => decision.workspaceId === wsId)
    }
    if (filter?.actions && filter.actions.length > 0) {
      const actions = filter.actions
      decisions = decisions.filter(decision => actions.includes(decision.action))
    }
    const start = filter?.offset ?? 0
    const end = filter?.limit !== undefined ? start + filter.limit : undefined
    return decisions.slice(start, end)
  }

  async load(decisionId: DecisionId): Promise<Decision> {
    const decision = this.decisions.find(d => d.id === decisionId)
    if (!decision)
      throw new NotFoundError(`Decision "${decisionId}" not found`)
    return decision
  }
}
