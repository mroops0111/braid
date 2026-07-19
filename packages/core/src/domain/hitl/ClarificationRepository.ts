import type { ClarificationFilter, ClarificationId } from '@braidhq/schema'
import type { Clarification } from './Clarification.js'

export interface ClarificationRepository {
  list: (filter?: ClarificationFilter) => Promise<Clarification[]>
  load: (clarificationId: ClarificationId) => Promise<Clarification>
  save: (clarification: Clarification) => Promise<void>
}
