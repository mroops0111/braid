import type { ModelRepository, StoragePlugin, StoragePluginContext } from '@braidhq/core'
import type { PluginId, StorageDescriptor, StorageKind, WorkspaceId } from '@braidhq/schema'
import { join } from 'node:path'
import { z } from 'zod'
import { KuzuModelRepository } from './KuzuModelRepository.js'

const KUZU_KIND = 'kuzu' as StorageKind

/**
 * StoragePlugin wrapper for the Kuzu adapter. The composition root
 * registers this against `PluginRegistry`; `composeFs.ts` then looks
 * up the active storage by `kind` rather than `import`-ing a concrete
 * repository class. This is what makes "swap storage backend" possible
 * without touching server code: a Neo4j plugin would register the same
 * way under `kind: 'neo4j'`.
 *
 * The plugin keeps the per-workspace path layout (`<workspace>/.braid/model.kuzu`)
 * because that path scheme is Kuzu-specific (it's a directory of native files,
 * not a hostname). Other storage plugins compute their own location from
 * the descriptor's `config`.
 */
export const kuzuStoragePlugin: StoragePlugin = Object.freeze({
  id: 'storage.kuzu' as PluginId,
  type: 'storage' as const,
  kind: KUZU_KIND,
  configSchema: z.object({}).passthrough(),
  createModelRepository: async (
    _descriptor: StorageDescriptor,
    context: StoragePluginContext,
  ): Promise<ModelRepository> => {
    return new KuzuModelRepository({
      resolveDbPath: async (workspaceId: WorkspaceId) => {
        const root = await context.resolveWorkspaceRoot(workspaceId)
        return join(root, '.braid', 'model.kuzu')
      },
    })
  },
})

export { KUZU_KIND }
