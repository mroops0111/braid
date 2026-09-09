import { SkillRunId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { RunOutputGate } from '../../../src/infrastructure/skill/RunOutputGate.js'

const RUN = SkillRunId.parse('skill-run-1')

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

  // A batch wants both. The doubt still gets recorded, it just has nobody
  // waiting to answer it, so refusing either would be refusing the mode.
  it('asks nothing of a run nobody is watching', () => {
    const gate = new RunOutputGate()
    gate.open(RUN, { unattended: true })
    expect(() => gate.assertMayPropose(RUN)).not.toThrow()
  })

  // A restart empties this, and how many times a run may submit is settled
  // from its records, so failing open here costs nothing and wedges nothing.
  it('asks nothing of a run this process never saw open', () => {
    expect(() => new RunOutputGate().assertMayPropose(RUN)).not.toThrow()
  })

  it('forgets a run once it is over', () => {
    const gate = attended()
    gate.declareNothingToClarify(RUN)
    gate.close(RUN)
    expect(() => gate.assertMayPropose(RUN)).not.toThrow()
  })
})
