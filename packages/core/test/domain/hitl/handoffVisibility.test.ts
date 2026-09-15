import type { Actor, UserId } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { handoffVisibleTo } from '../../../src/domain/hitl/handoffVisibility.js'

const alice = 'usr-alice' as UserId
const bob = 'usr-bob' as UserId

describe('handoffVisibleTo', () => {
  it('shows a viewer what they handed over themselves', () => {
    expect(handoffVisibleTo({ status: 'pending', owner: alice as Actor }, alice)).toBe(true)
  })

  it('hides what somebody else handed over and has not settled', () => {
    expect(handoffVisibleTo({ status: 'pending', owner: bob as Actor }, alice)).toBe(false)
  })

  it('shows what a service handed over, since it belongs to the workspace', () => {
    const autonomous = { status: 'pending' as const, owner: 'system' as Actor, ownerKind: 'service' as const }
    expect(handoffVisibleTo(autonomous, alice)).toBe(true)
  })

  it('shows an applied handoff to everybody, since it is now the graph\'s provenance', () => {
    expect(handoffVisibleTo({ status: 'applied', owner: bob as Actor }, alice)).toBe(true)
  })

  it('keeps a rejected or skipped handoff with the person who raised it', () => {
    expect(handoffVisibleTo({ status: 'rejected', owner: bob as Actor }, alice)).toBe(false)
    expect(handoffVisibleTo({ status: 'skipped', owner: bob as Actor }, alice)).toBe(false)
    expect(handoffVisibleTo({ status: 'answered', owner: bob as Actor }, alice)).toBe(false)
  })
})
