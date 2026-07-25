import { describe, expect, it } from 'vitest'
import {
  asAbsolutePath,
  asEdgeId,
  asLoaderKind,
  asMcpServerId,
  asNodeId,
  asOntologyId,
  asSourceId,
  asStorageKind,
} from '../../src/lib/brands'

// Every brand is z.string().min(1), so a non-empty string round-trips and
// an empty string is rejected by the underlying schema.
describe('brand constructors', () => {
  it('returns the input value for a non-empty string', () => {
    expect(asSourceId('billing')).toBe('billing')
    expect(asMcpServerId('drive')).toBe('drive')
    expect(asLoaderKind('git')).toBe('git')
    expect(asAbsolutePath('/tmp/repo')).toBe('/tmp/repo')
    expect(asStorageKind('filesystem')).toBe('filesystem')
    expect(asOntologyId('ddd')).toBe('ddd')
    expect(asNodeId('ctx.cart')).toBe('ctx.cart')
    expect(asEdgeId('e1')).toBe('e1')
  })

  it('throws on an empty string', () => {
    expect(() => asSourceId('')).toThrow()
    expect(() => asMcpServerId('')).toThrow()
    expect(() => asLoaderKind('')).toThrow()
    expect(() => asAbsolutePath('')).toThrow()
    expect(() => asStorageKind('')).toThrow()
    expect(() => asOntologyId('')).toThrow()
    expect(() => asNodeId('')).toThrow()
    expect(() => asEdgeId('')).toThrow()
  })
})
