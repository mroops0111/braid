import type { Decision } from '@telos/schema'
import type { DecisionRepository } from '../../src/index.js'

export class InMemoryDecisionRepository implements DecisionRepository {
  private decisions: Decision[] = []

  async append(decision: Decision): Promise<void> {
    this.decisions.push(decision)
  }

  async list(): Promise<Decision[]> {
    return [...this.decisions]
  }
}
