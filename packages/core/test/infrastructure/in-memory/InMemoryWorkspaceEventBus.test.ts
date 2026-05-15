import type { ProposalId, WorkspaceId } from '@telos/schema'
import type { WorkspaceEvent } from '../../../src/domain/events/WorkspaceEvent.js'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryWorkspaceEventBus } from '../../../src/infrastructure/in-memory/InMemoryWorkspaceEventBus.js'

const wsA = 'ws-a' as WorkspaceId
const wsB = 'ws-b' as WorkspaceId

function proposalCreated(workspaceId: WorkspaceId, idSuffix = '1'): WorkspaceEvent {
  return {
    type: 'proposal.created',
    workspaceId,
    proposalId: `prop-${idSuffix}` as ProposalId,
    at: '2026-05-15T00:00:00Z',
  }
}

describe('InMemoryWorkspaceEventBus', () => {
  it('fans out an event to every subscriber of the same workspace', () => {
    const bus = new InMemoryWorkspaceEventBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.subscribe(wsA, a)
    bus.subscribe(wsA, b)

    const event = proposalCreated(wsA)
    bus.publish(event)

    expect(a).toHaveBeenCalledWith(event)
    expect(b).toHaveBeenCalledWith(event)
  })

  it('does not deliver events to subscribers of other workspaces', () => {
    const bus = new InMemoryWorkspaceEventBus()
    const onA = vi.fn()
    const onB = vi.fn()
    bus.subscribe(wsA, onA)
    bus.subscribe(wsB, onB)

    bus.publish(proposalCreated(wsA))

    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).not.toHaveBeenCalled()
  })

  it('does not deliver to a listener that has unsubscribed', () => {
    const bus = new InMemoryWorkspaceEventBus()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(wsA, listener)
    unsubscribe()

    bus.publish(proposalCreated(wsA))

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps other listeners delivering when one unsubscribes', () => {
    const bus = new InMemoryWorkspaceEventBus()
    const stays = vi.fn()
    const leaves = vi.fn()
    bus.subscribe(wsA, stays)
    const unsubscribe = bus.subscribe(wsA, leaves)
    unsubscribe()

    bus.publish(proposalCreated(wsA))

    expect(stays).toHaveBeenCalledTimes(1)
    expect(leaves).not.toHaveBeenCalled()
  })

  it('tolerates a listener that unsubscribes itself during dispatch', () => {
    // Regression test: iterating the listener set directly would throw
    // if a listener mutates the set during iteration. Implementation
    // snapshots first.
    const bus = new InMemoryWorkspaceEventBus()
    const stays = vi.fn()
    let unsubscribeSelf: (() => void) | null = null
    const selfRemoving = vi.fn(() => unsubscribeSelf?.())
    unsubscribeSelf = bus.subscribe(wsA, selfRemoving)
    bus.subscribe(wsA, stays)

    bus.publish(proposalCreated(wsA))

    expect(selfRemoving).toHaveBeenCalledTimes(1)
    expect(stays).toHaveBeenCalledTimes(1)

    // The self-removing listener should no longer fire on the next publish.
    bus.publish(proposalCreated(wsA, '2'))
    expect(selfRemoving).toHaveBeenCalledTimes(1)
    expect(stays).toHaveBeenCalledTimes(2)
  })

  it('is a no-op when publishing to a workspace with no subscribers', () => {
    const bus = new InMemoryWorkspaceEventBus()
    // No exception, no listeners called.
    expect(() => bus.publish(proposalCreated(wsA))).not.toThrow()
  })

  it('does not deliver events published before subscribe (no replay)', () => {
    const bus = new InMemoryWorkspaceEventBus()
    bus.publish(proposalCreated(wsA))

    const late = vi.fn()
    bus.subscribe(wsA, late)

    expect(late).not.toHaveBeenCalled()
  })

  it('supports re-subscribe after fully unsubscribing the workspace', () => {
    // After every listener unsubscribes, the bus should drop the bucket;
    // a fresh subscribe must still work.
    const bus = new InMemoryWorkspaceEventBus()
    const first = vi.fn()
    const unsub = bus.subscribe(wsA, first)
    unsub()

    const second = vi.fn()
    bus.subscribe(wsA, second)
    bus.publish(proposalCreated(wsA))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
