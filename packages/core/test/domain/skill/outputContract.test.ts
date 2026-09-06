import type { BlockId, EmittedBlock, SkillOutputContract } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { describeViolations, validateOutput } from '../../../src/domain/skill/outputContract.js'

function block(call: EmittedBlock['block']['call'], audience: 'business' | 'engineering' | 'both'): EmittedBlock {
  const base = { audience }
  switch (call) {
    case 'showAnswer':
      return { id: 'b1' as BlockId, block: { ...base, call, markdown: 'text' } }
    case 'showTrace':
      return { id: 'b2' as BlockId, block: { ...base, call, searched: [], read: [], cited: [], skipped: [] } }
    default:
      return { id: 'b3' as BlockId, block: { ...base, call: 'showEvidence', refs: [] } as EmittedBlock['block'] }
  }
}

const contract: SkillOutputContract = {
  requiredCalls: ['showAnswer', 'showTrace'],
  minPerAudience: { engineering: 1 },
  maxRetries: 1,
}

describe('validateOutput', () => {
  it('passes a run that met every clause', () => {
    const blocks = [
      block('showAnswer', 'business'),
      block('showTrace', 'both'),
      block('showEvidence', 'engineering'),
    ]

    expect(validateOutput(contract, blocks)).toEqual([])
  })

  it('reports a call the run never made', () => {
    const violations = validateOutput(contract, [block('showAnswer', 'engineering')])

    expect(violations).toContainEqual({ kind: 'missing-call', target: 'showTrace', found: 0, required: 1 })
  })

  it('does not let a `both` block satisfy an audience minimum', () => {
    const blocks = [block('showAnswer', 'business'), block('showTrace', 'both')]

    const violations = validateOutput(contract, blocks)

    expect(violations).toContainEqual({ kind: 'missing-audience', target: 'engineering', found: 0, required: 1 })
  })

  it('finds nothing to report when the contract asks for nothing', () => {
    const empty: SkillOutputContract = { requiredCalls: [], minPerAudience: {}, maxRetries: 0 }

    expect(validateOutput(empty, [])).toEqual([])
  })
})

describe('describeViolations', () => {
  it('names the gap rather than restating the request', () => {
    const text = describeViolations(validateOutput(contract, [block('showAnswer', 'business')]))

    expect(text).toContain('showTrace')
    expect(text).toContain('engineering')
    expect(text).toContain('Do not repeat what you')
  })
})
