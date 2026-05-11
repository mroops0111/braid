import type { Decision } from '@telos/schema'

export interface DecisionRepository {
  append: (decision: Decision) => Promise<void>
  list: () => Promise<Decision[]>
}
