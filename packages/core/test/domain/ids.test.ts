import type { Timestamp } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { newClarifyTicketId, newEdgeId, newNodeId, newProposalId } from '../../src/index.js'

const NOW = '2026-05-22T14:30:00.000Z' as Timestamp

describe('id minters', () => {
  it('newNodeId returns a non-empty unique string', () => {
    const a = newNodeId()
    const b = newNodeId()
    expect(a).not.toBe(b)
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(0)
  })

  it('newEdgeId returns distinct uuids', () => {
    const ids = [newEdgeId(), newEdgeId()]
    expect(new Set(ids).size).toBe(2)
  })

  it('newProposalId embeds the date prefix and a short random suffix', () => {
    const id = newProposalId(NOW)
    expect(id).toMatch(/^p-2026-05-22-[0-9a-f]{8}$/)
  })

  it('newClarifyTicketId embeds the date prefix and a short random suffix', () => {
    const id = newClarifyTicketId(NOW)
    expect(id).toMatch(/^ct-2026-05-22-[0-9a-f]{8}$/)
  })

  it('two same-day proposal ids do not collide', () => {
    expect(newProposalId(NOW)).not.toBe(newProposalId(NOW))
  })
})
