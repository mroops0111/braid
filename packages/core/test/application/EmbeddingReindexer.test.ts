import type { WorkspaceEvent, WorkspaceId } from '@braidhq/schema'
import type { EmbeddingService } from '../../src/application/EmbeddingService.js'
import type { WorkspaceEventListener } from '../../src/application/WorkspaceEventBus.js'
import { describe, expect, it, vi } from 'vitest'
import { startEmbeddingReindexer } from '../../src/application/EmbeddingReindexer.js'

const WORKSPACE = 'ws' as WorkspaceId

function event(type: WorkspaceEvent['type']): WorkspaceEvent {
  return { type, workspaceId: WORKSPACE, at: '2026-05-21T10:00:00.000Z' } as WorkspaceEvent
}

function harness(rebuild: () => Promise<unknown> = async () => undefined) {
  let listener: WorkspaceEventListener = () => {}
  const eventBus = {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    subscribeAll: vi.fn((next: WorkspaceEventListener) => {
      listener = next
      return () => {}
    }),
  }
  const embeddingService = { rebuild: vi.fn(rebuild) } as unknown as EmbeddingService
  const stop = startEmbeddingReindexer({ eventBus, embeddingService })
  return { emit: (type: WorkspaceEvent['type']) => listener(event(type)), embeddingService, stop }
}

describe('startEmbeddingReindexer', () => {
  it('reindexes after a restore, which rewinds the graph without an apply', async () => {
    const { emit, embeddingService } = harness()
    emit('workspace.restored')
    expect(embeddingService.rebuild).toHaveBeenCalledWith(WORKSPACE)
  })

  it('reindexes after a proposal lands', async () => {
    const { emit, embeddingService } = harness()
    emit('proposal.applied')
    expect(embeddingService.rebuild).toHaveBeenCalledWith(WORKSPACE)
  })

  it('ignores an event that cannot have changed a node', async () => {
    const { emit, embeddingService } = harness()
    emit('run.started')
    expect(embeddingService.rebuild).not.toHaveBeenCalled()
  })

  it('does not stack rebuilds while one is still running', async () => {
    let release: (() => void) | undefined
    const { emit, embeddingService } = harness(() => new Promise<void>((resolve) => {
      release = resolve
    }))

    emit('proposal.applied')
    emit('proposal.applied')
    emit('workspace.restored')

    // A batch emits many of these in a row, and each rebuild reads the whole
    // index, so overlapping them would repeat the same work.
    expect(embeddingService.rebuild).toHaveBeenCalledTimes(1)
    release?.()
  })

  it('survives a failed rebuild, so the next event still reindexes', async () => {
    let settled = 0
    const { emit, embeddingService } = harness(async () => {
      try {
        throw new Error('ollama is down')
      }
      finally {
        settled += 1
      }
    })

    emit('proposal.applied')
    // The slot is only freed once the rejection has been handled,
    // so waiting on the call count would race the cleanup.
    await vi.waitFor(() => expect(settled).toBe(1))
    await Promise.resolve()

    emit('proposal.applied')
    await vi.waitFor(() => expect(embeddingService.rebuild).toHaveBeenCalledTimes(2))
  })
})
