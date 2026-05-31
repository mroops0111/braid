import type { ModelSnapshot } from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

/**
 * Port for reading / writing the workspace's persisted graph state to
 * a versioned, human-diffable file (`artifacts/graph.json`). The file
 * is the disk source of truth for the workspace; storage backends
 * (Kùzu, future Neo4j, etc.) are treated as regenerable query caches
 * that this serialiser can rehydrate at any time.
 *
 * Implementations are expected to:
 *
 * - Write a deterministic representation (e.g. nodes / edges sorted
 *   by id) so commits hold to git's minimal-diff promise.
 * - Treat the workspace's root path as the only mutable input; no
 *   environment-derived paths or globals.
 * - Stay impl-agnostic of the calling storage plugin so the same
 *   `graph.json` can rehydrate any registered `ModelRepository`.
 */
export interface GraphSerializer {
  /**
   * Overwrite the workspace's `graph.json` with `snapshot`. The impl
   * sorts nodes / edges deterministically; callers don't need to
   * pre-sort.
   */
  write: (workspace: Workspace, snapshot: ModelSnapshot) => Promise<void>

  /**
   * Read the workspace's `graph.json`. Returns `null` when the file
   * doesn't exist yet (fresh workspace, or one created before this
   * serialiser was wired). Throws on malformed contents so silent
   * corruption can't slip through bootstrap.
   */
  read: (workspace: Workspace) => Promise<ModelSnapshot | null>

  /**
   * Cheap predicate for "has graph.json ever been written here?".
   * Lets bootstrap make a sync / dump decision without paying the
   * read + parse cost of `read`.
   */
  exists: (workspace: Workspace) => Promise<boolean>
}
