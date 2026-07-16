import type { StorageDescriptor, StorageKind, WorkspaceId } from '@braidhq/schema'
import type { ModelRepository } from '../model/ModelRepository.js'
import type { Plugin, PluginContext } from './Plugin.js'

/**
 * Per-storage context handed to a plugin,
 * when the composition root asks it to materialise its `ModelRepository`.
 * The plugin uses `resolveWorkspaceRoot` to locate per-workspace state,
 * e.g. a Kuzu db directory under `<workspace>/.braid/`,
 * without owning the workspace registry itself.
 */
export interface StoragePluginContext extends PluginContext {
  readonly resolveWorkspaceRoot: (workspaceId: WorkspaceId) => Promise<string>
}

/**
 * Graph-storage backend port. Storage here is strictly the graph (nodes / edges / future vector index),
 * filesystem-backed concerns like Proposal / Clarify are *not* part of this contract,
 * because they live in `<workspace>/artifacts/` and are not swappable on a graph-backend axis.
 *
 * A plugin returns one `ModelRepository` per process,
 * that repository is responsible for routing per-workspace via the context's resolver.
 * This mirrors how `KuzuModelRepository` already takes a `resolveDbPath`.
 */
export interface StoragePlugin extends Plugin {
  readonly type: 'storage'
  readonly kind: StorageKind
  createModelRepository: (descriptor: StorageDescriptor, context: StoragePluginContext) => Promise<ModelRepository>
}
