import type { BatchUnit } from '@braidhq/schema'
import { BatchUnit as BatchUnitSchema } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { dddOntology } from '../src/DDDOntology.js'

describe('dddOntology configuration', () => {
  it('declares the ddd ontology id and reuses it as the skill namespace', () => {
    expect(dddOntology.ontologyId).toBe('ddd')
    expect(dddOntology.skillNamespace).toBe('ddd')
  })

  it('requires both an intent and a code source', () => {
    expect(dddOntology.requiredSourceRoles).toEqual(['intent', 'code'])
  })

  it('ships three skills whose directories are the bare verbs', () => {
    const verbs = (dddOntology.skills ?? []).map((skill) => {
      const path = typeof skill.directory === 'string' ? skill.directory : skill.directory.pathname
      return path.replace(/\/+$/, '').split('/').pop()
    })
    expect(verbs).toEqual(['extract', 'clarify', 'reconcile'])
  })

  it('binds the batch loop: extract per unit, reconcile as the chunked checkpoint, scan to derive units', () => {
    const batch = dddOntology.batch
    expect(batch?.perUnit.skillId).toBe('ddd:extract')
    expect(batch?.checkpoint?.skillId).toBe('ddd:reconcile')
    expect(batch?.checkpoint?.chunkSize).toBe(5)
    expect(batch?.checkpoint?.runAtEnd).toBe(true)
    expect(batch?.deriveUnits?.skillId).toBe('braid:scan')
  })
})

describe('dddOntology batch checkpoint extraEnv', () => {
  const extraEnv = dddOntology.batch?.checkpoint?.extraEnv

  function unit(fields: { sourceId?: string, scopeHint?: string }): BatchUnit {
    return BatchUnitSchema.parse({
      id: 'u-1',
      name: 'unit',
      description: '',
      status: 'pending',
      ...(fields.sourceId ? { sourceId: fields.sourceId } : {}),
      ...(fields.scopeHint ? { scopeHint: fields.scopeHint } : {}),
    })
  }

  it('is declared on the checkpoint', () => {
    expect(extraEnv).toBeTypeOf('function')
  })

  it('joins sourceId::scopeHint for the units that carry both', () => {
    const env = extraEnv!([
      unit({ sourceId: 'src-a', scopeHint: 'orders' }),
      unit({ sourceId: 'src-b', scopeHint: 'billing' }),
    ])
    expect(env).toEqual({ BRAID_CHANGED_UNITS: 'src-a::orders\nsrc-b::billing' })
  })

  it('drops any unit missing a sourceId or a scopeHint', () => {
    const env = extraEnv!([
      unit({ sourceId: 'src-a', scopeHint: 'orders' }),
      unit({ sourceId: 'src-b' }),
      unit({ scopeHint: 'billing' }),
    ])
    expect(env).toEqual({ BRAID_CHANGED_UNITS: 'src-a::orders' })
  })

  it('returns an empty env when no unit carries both fields', () => {
    expect(extraEnv!([unit({ sourceId: 'src-a' }), unit({})])).toEqual({})
    expect(extraEnv!([])).toEqual({})
  })
})
