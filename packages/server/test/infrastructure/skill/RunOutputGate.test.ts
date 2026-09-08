import { SkillRunId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { RunOutputGate } from '../../../src/infrastructure/skill/RunOutputGate.js'

const RUN = SkillRunId.parse('skill-run-1')
const RESUMED = SkillRunId.parse('skill-run-2')

function attended(): RunOutputGate {
  const gate = new RunOutputGate()
  gate.open(RUN, { unattended: false })
  return gate
}

describe('runOutputGate', () => {
  it('refuses a proposal from a run that has not said whether anything needs clarifying', () => {
    expect(() => attended().assertMayPropose(RUN)).toThrow(/report_no_clarification/)
  })

  it('lets a run propose once it reports there was nothing to ask', () => {
    const gate = attended()
    gate.declareNothingToClarify(RUN)
    expect(() => gate.assertMayPropose(RUN)).not.toThrow()
  })

  it('stops a run that asked from also proposing', () => {
    const gate = attended()
    gate.assertMayClarify(RUN)
    expect(() => gate.assertMayPropose(RUN)).toThrow(/stops here/)
  })

  // Mutual exclusion alone would lose the doubt, since whichever call came
  // first would win. Requiring the declaration up front is what stops a run
  // reaching this state at all.
  it('stops a run that proposed from asking afterwards', () => {
    const gate = attended()
    gate.declareNothingToClarify(RUN)
    gate.assertMayPropose(RUN)
    expect(() => gate.assertMayClarify(RUN)).toThrow(/already proposed/)
  })

  // Answering starts a new run that continues the same conversation, and that
  // run exists to propose. Keying the gate by conversation would deadlock it.
  it('gives a resumed run a clean slate, so answering leads somewhere', () => {
    const gate = attended()
    gate.assertMayClarify(RUN)
    gate.close(RUN)

    gate.open(RESUMED, { unattended: false })
    gate.declareNothingToClarify(RESUMED)
    expect(() => gate.assertMayPropose(RESUMED)).not.toThrow()
  })

  it('gates nothing when nobody is waiting, since a batch wants both', () => {
    const gate = new RunOutputGate()
    gate.open(RUN, { unattended: true })
    gate.assertMayClarify(RUN)
    expect(() => gate.assertMayPropose(RUN)).not.toThrow()
  })

  it('gates nothing for a run it never saw open, so an untracked caller is not blocked', () => {
    expect(() => new RunOutputGate().assertMayPropose(RUN)).not.toThrow()
  })
})
