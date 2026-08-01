import type { ClarificationCandidate, ClarificationCandidateId, ClarificationId, UserId, WorkspaceId } from '@braidhq/schema'
import { Clarification } from '@braidhq/core'
import { mintTestId } from './ids.js'

export interface MakeClarificationOptions {
  readonly id?: string
  readonly status?: 'pending' | 'answered'
  readonly candidates?: readonly ClarificationCandidate[]
  readonly selectedCandidateId?: ClarificationCandidateId
  readonly answeredBy?: UserId
}

/**
 * Construct a Clarification for tests, a pending ticket by default.
 * Pass status 'answered' with a selectedCandidateId to resolve it.
 */
export function makeClarification(workspaceId: WorkspaceId, overrides: MakeClarificationOptions = {}): Clarification {
  const status = overrides.status ?? 'pending'
  return new Clarification({
    id: (overrides.id ?? mintTestId('ct')) as ClarificationId,
    workspaceId,
    question: 'q?',
    candidates: [...(overrides.candidates ?? [])],
    status,
    owner: 'system',
    origin: 'skill',
    ...(status === 'answered' && overrides.selectedCandidateId
      ? {
          selectedCandidateId: overrides.selectedCandidateId,
          resolution: [],
          answeredBy: overrides.answeredBy ?? ('u-1' as UserId),
        }
      : {}),
  })
}
