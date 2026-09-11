import type { Clarification } from './Clarification.js'

/**
 * What became of a question a run stopped on.
 *
 * Three ways out and every one of them carries the run on,
 * because the run asked in order to keep going.
 * Only the reason differs, so only the sentence the run is told differs,
 * and a reader who deferred is not the same as one who skipped,
 * even though neither produced an answer.
 */
export type ClarificationOutcome = 'answered' | 'deferred' | 'skipped'

export interface ClarificationOutcomeRule {
  readonly outcome: ClarificationOutcome
  /** Whether this is what the record now says happened. */
  matches: (clarification: Clarification) => boolean
  /** What the run is told, in the reviewer's terms rather than in ours. */
  describe: (clarification: Clarification) => string
}

const answered: ClarificationOutcomeRule = {
  outcome: 'answered',
  matches: clarification => clarification.status === 'answered',
  describe: (clarification) => {
    const chosen = clarification.candidates.find(
      candidate => candidate.id === clarification.selectedCandidateId,
    )
    const answer = chosen ? chosen.description : 'recorded, with no candidate named'
    return `${clarification.question}\nThe reviewer answered: ${answer}. Please carry on and do not raise it again.`
  },
}

// Deferring gives up the conversation, not the question.
// It stays pending and stands on its own,
// so a later step still owes an answer even though this run does not wait.
const deferred: ClarificationOutcomeRule = {
  outcome: 'deferred',
  matches: clarification => clarification.status === 'pending' && clarification.answerMode === 'standing',
  describe: clarification => `${clarification.question}\nThe reviewer chose to answer this later. Please carry on without it and do not raise it again.`,
}

const skipped: ClarificationOutcomeRule = {
  outcome: 'skipped',
  matches: clarification => clarification.status === 'skipped',
  describe: clarification => `${clarification.question}\nThe reviewer set this question aside. Please carry on without it and do not raise it again.`,
}

export const CLARIFICATION_OUTCOME_RULES: readonly ClarificationOutcomeRule[] = [answered, deferred, skipped]

/** Null while the question is still open, so nothing carries the run on yet. */
export function outcomeOf(clarification: Clarification): ClarificationOutcomeRule | null {
  return CLARIFICATION_OUTCOME_RULES.find(rule => rule.matches(clarification)) ?? null
}

/**
 * What to tell a run so it takes up where it stopped.
 *
 * One paragraph per question, holding the question,
 * what the reviewer did, and what to do about it.
 * A run parked on three questions can be released by three decisions,
 * so each one carries its own,
 * and nothing above them claims a state two of the outcomes contradict.
 */
export function describeContinuation(clarifications: readonly Clarification[]): string {
  return clarifications
    .flatMap((clarification) => {
      const rule = outcomeOf(clarification)
      return rule ? [rule.describe(clarification)] : []
    })
    .join('\n\n')
}
