import type { AudienceId, BlockId, EmittedBlock, SkillOutputContract } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { describeViolations, validateOutput } from '../../../src/domain/skill/outputContract.js'

const PM = 'business' as AudienceId
const RD = 'engineering' as AudienceId
const DECLARED = [PM, RD]

let nextId = 0
function block(
  call: 'showAnswer' | 'showTrace' | 'showEvidence',
  audiences: AudienceId[] = [],
): EmittedBlock {
  nextId += 1
  const id = `b${nextId}` as BlockId
  const base = { audiences }
  if (call === 'showAnswer')
    return { id, block: { ...base, call, markdown: 'text' } }
  if (call === 'showTrace')
    return { id, block: { ...base, call, searched: [], read: [], cited: [], skipped: [] } }
  return { id, block: { ...base, call, refs: [] } }
}

const contract: SkillOutputContract = {
  requiredCalls: ['showAnswer', 'showTrace'],
  coverDeclaredAudiences: 2,
  maxRetries: 1,
}

describe('validateOutput', () => {
  it('passes when every declared audience is covered', () => {
    const blocks = [block('showAnswer'), block('showTrace'), block('showEvidence', [RD])]

    expect(validateOutput(contract, blocks, DECLARED)).toEqual([])
  })

  it('counts a block naming nobody toward every audience, since everyone sees it', () => {
    const blocks = [block('showAnswer'), block('showTrace')]

    expect(validateOutput(contract, blocks, DECLARED)).toEqual([])
  })

  it('reports the audience a run left short', () => {
    const blocks = [block('showAnswer', [PM]), block('showTrace', [PM])]

    const violations = validateOutput(contract, blocks, DECLARED)

    expect(violations).toContainEqual({ kind: 'missing-audience', target: RD, found: 0, required: 2 })
    expect(violations.some(v => v.target === PM)).toBe(false)
  })

  it('reports a call the run never made', () => {
    const violations = validateOutput(contract, [block('showAnswer')], DECLARED)

    expect(violations).toContainEqual({ kind: 'missing-call', target: 'showTrace', found: 0, required: 1 })
  })

  it('checks no audience when the ontology declares none', () => {
    const blocks = [block('showAnswer'), block('showTrace')]

    expect(validateOutput(contract, blocks, [])).toEqual([])
  })

  it('finds nothing to report when the contract asks for nothing', () => {
    const empty: SkillOutputContract = { requiredCalls: [], maxRetries: 0 }

    expect(validateOutput(empty, [], DECLARED)).toEqual([])
  })
})

describe('describeViolations', () => {
  it('names the gap rather than restating the request', () => {
    const blocks = [block('showAnswer', [PM])]
    const text = describeViolations(validateOutput(contract, blocks, DECLARED))

    expect(text).toContain('showTrace')
    expect(text).toContain('engineering')
    expect(text).toContain('Do not repeat what you')
  })
})
