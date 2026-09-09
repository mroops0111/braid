import type { SkillRunId } from '@braidhq/schema'
import { ValidationError } from '@braidhq/core'

/**
 * The run's own statement that it found nothing to ask about.
 *
 * A run either raises a question and stops, or says there is nothing to ask
 * and proposes. Told only in a prompt, that held about half the time: a run
 * would model most of a spec, submit it, and only then notice the thing it
 * could not decide, leaving a reviewer to approve a change the answer might
 * overturn.
 *
 * Mutual exclusion alone would be worse rather than better. Whichever call
 * came first would win, so a run that proposed before noticing its doubt would
 * have the doubt refused, and the ambiguity would be lost rather than raised.
 * The gate therefore makes proposing conditional on having already decided:
 * a run says there is nothing to clarify before it may propose, which forces
 * the decision to the point where it is still cheap to make.
 *
 * Keyed by run, never by conversation. Answering a clarification starts a new
 * run that continues the same session, and that run must be free to propose,
 * which is the whole point of resuming it.
 *
 * Unattended runs are not gated at all. A batch that applies its own output
 * wants both, the proposal for coverage and the clarification so the doubt is
 * still visible, and refusing one of them would be refusing the mode.
 */
export class RunOutputGate {
  private readonly runs = new Map<SkillRunId, { unattended: boolean, declared: boolean }>()

  open(runId: SkillRunId, options: { unattended: boolean }): void {
    this.runs.set(runId, { unattended: options.unattended, declared: false })
  }

  close(runId: SkillRunId): void {
    this.runs.delete(runId)
  }

  /**
   * Called before a proposal is created, throwing when nothing was declared.
   *
   * Fails open for a run this process never saw open, which is what a restart
   * leaves behind. Losing a declaration must not wedge a run, because how many
   * times a run may submit is settled from its records rather than from here.
   */
  assertMayPropose(runId: SkillRunId | undefined): void {
    const state = this.stateFor(runId)
    if (!state || state.unattended || state.declared)
      return
    throw new ValidationError(
      'This run has not said whether anything needs clarifying. Call `report_no_clarification` when the sources left you in no doubt, or raise the clarification now, since deciding after the fact costs a reviewer the chance to see the doubt.',
    )
  }

  /** The run's declaration that it found nothing to ask about. */
  declareNothingToClarify(runId: SkillRunId | undefined): void {
    const state = this.stateFor(runId)
    if (!state)
      return
    state.declared = true
  }

  private stateFor(runId: SkillRunId | undefined): { unattended: boolean, declared: boolean } | undefined {
    return runId ? this.runs.get(runId) : undefined
  }
}
