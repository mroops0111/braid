import type { SkillArtifactKind, SkillRunId } from '@braidhq/schema'
import type { Clarification } from './Clarification.js'
import type { Proposal } from './Proposal.js'

/**
 * What one run has already written, as the rules need to read it.
 *
 * Loaded from the repositories rather than remembered, because how many times
 * a run may submit has to hold across a restart, and anything kept in memory
 * is gone the moment the process is.
 */
export interface RunSubmissions {
  readonly proposals: readonly Proposal[]
  /** Questions of this run's that a conversation is still parked on. */
  readonly blocking: readonly Clarification[]
}

/**
 * Whether a run may still write one kind of thing.
 *
 * One rule per kind rather than a branch inside one check, so a kind that
 * arrives later brings its own rule instead of another arm of a conditional,
 * and so each rule can be read and tested on its own.
 */
export interface RunSubmissionRule {
  readonly kind: SkillArtifactKind
  /** Why this run may not write one, or null when it may. */
  refuse: (runId: SkillRunId, written: RunSubmissions) => string | null
}

/**
 * One run reads one thing and proposes one change to it.
 *
 * A second proposal from the same run is the model splitting arbitrarily, and
 * it costs a reviewer two decisions where the run made one. A run parked on a
 * question proposes nothing at all until the answer carries it on, since a
 * proposal resting on an open question asks for approval of what the answer
 * may overturn.
 */
export const proposalSubmission: RunSubmissionRule = {
  kind: 'proposal',
  refuse(runId, written) {
    if (written.proposals.length > 0) {
      return `Run "${runId}" has already proposed. One run reads one thing and proposes one change to it, so revise that proposal rather than filing a second.`
    }
    const blocking = written.blocking[0]
    if (blocking) {
      return `Run "${runId}" is waiting on "${blocking.id}", so it stops here. Answering it continues this same conversation, and you propose then, against the graph as it stands at that moment.`
    }
    return null
  },
}

/**
 * Doubt is raised before anything is submitted, never after.
 *
 * A run that has proposed has already decided, so a question from it arrives
 * too late to be worth anything: the reviewer is holding a change that the
 * answer might undo. Asking as many times as it needs to is fine, because
 * they are answered together as the one interrupt the run is parked on.
 */
export const clarificationSubmission: RunSubmissionRule = {
  kind: 'clarify',
  refuse(runId, written) {
    if (written.proposals.length > 0) {
      return `Run "${runId}" has already proposed, so it cannot also ask. Raise what you could not decide before you submit anything.`
    }
    return null
  },
}

export const RUN_SUBMISSION_RULES: readonly RunSubmissionRule[] = [
  proposalSubmission,
  clarificationSubmission,
]
