import type { Decision, DecisionFilter, DecisionId } from '@telos/schema'

export interface DecisionRepository {
  list: (filter?: DecisionFilter) => Promise<Decision[]>
  load: (decisionId: DecisionId) => Promise<Decision>
  append: (decision: Decision) => Promise<void>
}
