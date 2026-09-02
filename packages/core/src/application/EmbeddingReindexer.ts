import type { WorkspaceEvent, WorkspaceId } from '@braidhq/schema'
import type { EmbeddingService } from './EmbeddingService.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'

/**
 * Events after which the graph's text may differ from what the index holds.
 *
 * A restore is the one that is easy to miss.
 * It rewinds the model without going through an apply,
 * so a vector built from newer text would otherwise outlive it.
 */
const REINDEX_AFTER: ReadonlySet<WorkspaceEvent['type']> = new Set([
  'proposal.applied',
  'clarification.applied',
  'workspace.restored',
  'batch.completed',
])

export interface EmbeddingReindexerDeps {
  readonly eventBus: WorkspaceEventBus
  readonly embeddingService: EmbeddingService
  readonly onError?: (workspaceId: WorkspaceId, error: unknown) => void
}

/**
 * Keeps the vector index in step with the graph.
 *
 * Subscribed to the bus rather than called from each route,
 * so a future mutation path cannot forget to reindex.
 * Rebuilds are incremental,
 * so an event that changed one node costs one model call.
 */
export function startEmbeddingReindexer(deps: EmbeddingReindexerDeps): () => void {
  // One rebuild per workspace at a time.
  // A batch emits many events in a row,
  // and each rebuild reads the whole index,
  // so overlapping them would do the same work several times over.
  const running = new Map<WorkspaceId, Promise<unknown>>()

  return deps.eventBus.subscribeAll((event) => {
    if (!REINDEX_AFTER.has(event.type) || running.has(event.workspaceId))
      return
    const task = deps.embeddingService
      .rebuild(event.workspaceId)
      .catch(error => deps.onError?.(event.workspaceId, error))
      .finally(() => running.delete(event.workspaceId))
    running.set(event.workspaceId, task)
  })
}
