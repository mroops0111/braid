import type { ClarificationCandidate, ClarificationCandidateId, ClarificationId, ClarificationStatus, SkillRunId, UserId, WorkspaceId } from '@braidhq/schema'
import { Clarification } from '@braidhq/core'
import { mintTestId } from './ids.js'

export interface MakeClarificationOptions {
  readonly id?: string
  readonly status?: ClarificationStatus
  readonly candidates?: readonly ClarificationCandidate[]
  readonly selectedCandidateId?: ClarificationCandidateId
  readonly answeredBy?: UserId
  /** The run that raised it. Left off, it reads as human-filed. */
  readonly skillRunId?: string
  /** Whether a conversation is parked on the answer. */
  readonly answerMode?: 'resumes' | 'standing'
}

/**
 * Construct a Clarification for tests, a pending clarification by default.
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
    ...(overrides.skillRunId ? { skillRunId: overrides.skillRunId as SkillRunId } : {}),
    ...(overrides.answerMode ? { answerMode: overrides.answerMode } : {}),
    ...(status === 'answered' && overrides.selectedCandidateId
      ? {
          selectedCandidateId: overrides.selectedCandidateId,
          resolution: [],
          answeredBy: overrides.answeredBy ?? ('u-1' as UserId),
        }
      : {}),
  })
}
