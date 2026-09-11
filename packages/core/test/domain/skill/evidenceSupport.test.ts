import type { FindingSide } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { evidenceSupport } from '../../../src/domain/skill/evidenceSupport.js'

function side(...provenances: readonly ('graph' | 'agent')[]): FindingSide {
  return {
    summary: 'A side.',
    refs: provenances.map(provenance => ({
      provenance,
      reference: { sourceId: 'spec', location: { uri: 'docs/spec.md', startLine: 1 } },
    })) as FindingSide['refs'],
  }
}

describe('evidenceSupport', () => {
  it('reads corroborated when every side cites the graph', () => {
    expect(evidenceSupport([side('graph'), side('graph')])).toBe('corroborated')
  })

  it('reads corroborated when a side mixes a graph citation with its own reading', () => {
    expect(evidenceSupport([side('graph', 'agent'), side('graph')])).toBe('corroborated')
  })

  it('reads partial when one side rests only on what the run read itself', () => {
    expect(evidenceSupport([side('graph'), side('agent')])).toBe('partial')
  })

  it('reads thin when a side carries no reference', () => {
    expect(evidenceSupport([side('graph'), side()])).toBe('thin')
  })

  it('lets the weakest side decide rather than the strongest', () => {
    expect(evidenceSupport([side('graph', 'graph'), side('agent')])).toBe('partial')
  })
})
