import type { SourceId, SourceSyncPolicy, WorkspaceId } from '@braidhq/schema'
import { at } from '@braidhq/test-utils'
import { describe, expect, it } from 'vitest'
import { SourceSyncState } from '../../../src/domain/source/SourceSyncState.js'

const workspaceId = 'ws-1' as WorkspaceId
const sourceId = 'src-1' as SourceId
const oneMinute: SourceSyncPolicy = { maxStalenessMs: 60_000 }

function initial(): SourceSyncState {
  return SourceSyncState.initial(workspaceId, sourceId)
}

describe('SourceSyncState', () => {
  it('starts with no attempt recorded and no failures', () => {
    const state = initial()
    expect(state.lastAttemptAt).toBeUndefined()
    expect(state.lastSuccessAt).toBeUndefined()
    expect(state.consecutiveFailures).toBe(0)
  })

  it('is never fresh before its first success, so the first read pulls', () => {
    expect(initial().isFreshAt(at(0), oneMinute)).toBe(false)
  })

  it('is fresh inside the budget and stale once past it', () => {
    const synced = initial().recordSuccess(at(0))
    expect(synced.isFreshAt(at(59), oneMinute)).toBe(true)
    expect(synced.isFreshAt(at(60), oneMinute)).toBe(false)
    expect(synced.isFreshAt(at(600), oneMinute)).toBe(false)
  })

  it('reports staleness only once a success exists', () => {
    expect(initial().stalenessAt(at(0))).toBeUndefined()
    expect(initial().recordSuccess(at(0)).stalenessAt(at(90))).toBe(90_000)
  })

  it('records a revision when the loader reports one', () => {
    expect(initial().recordSuccess(at(0), 'abc123').revision).toBe('abc123')
    expect(initial().recordSuccess(at(0)).revision).toBeUndefined()
  })

  it('counts consecutive failures and keeps the last message', () => {
    const failedTwice = initial()
      .recordFailure(at(0), 'connection refused')
      .recordFailure(at(30), 'token expired')
    expect(failedTwice.consecutiveFailures).toBe(2)
    expect(failedTwice.lastError).toBe('token expired')
    expect(failedTwice.lastAttemptAt).toBe(at(30))
    expect(failedTwice.lastSuccessAt).toBeUndefined()
  })

  it('clears the failure streak and the stale error once a sync succeeds', () => {
    const recovered = initial()
      .recordFailure(at(0), 'connection refused')
      .recordSuccess(at(60), 'abc123')
    expect(recovered.consecutiveFailures).toBe(0)
    expect(recovered.lastError).toBeUndefined()
    expect(recovered.lastSuccessAt).toBe(at(60))
  })

  it('keeps a failed attempt from passing as fresh', () => {
    const staleAfterFailure = initial().recordSuccess(at(0)).recordFailure(at(120), 'unreachable')
    expect(staleAfterFailure.isFreshAt(at(120), oneMinute)).toBe(false)
    expect(staleAfterFailure.lastSuccessAt).toBe(at(0))
  })

  it('never mutates the instance a transition was called on', () => {
    const state = initial()
    state.recordFailure(at(0), 'boom')
    expect(state.consecutiveFailures).toBe(0)
  })
})
