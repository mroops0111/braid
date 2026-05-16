import type { Decision, DecisionFilter, DecisionId } from '@braidhq/schema'

export interface DecisionRepository {
  list: (filter?: DecisionFilter) => Promise<Decision[]>
  load: (decisionId: DecisionId) => Promise<Decision>
  append: (decision: Decision) => Promise<void>
}
