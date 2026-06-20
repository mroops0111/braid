import type { StoragePlugin } from '@braidhq/core'
import type { StorageKind, WorkspaceId } from '@braidhq/schema'
import { join } from 'node:path'
import { defineStoragePlugin } from '@braidhq/sdk'
import { z } from 'zod'
import { KuzuModelRepository } from './KuzuModelRepository.js'

const KUZU_KIND = 'kuzu' as StorageKind

const KuzuStorageConfig = z.object({}).passthrough()

/**
 * StoragePlugin for the embedded Kuzu adapter. The composition root
 * registers this against `PluginRegistry`; `composeFsApp` then looks up
 * the active storage by `kind` rather than `import`-ing the concrete
 * repository class. Other storage backends (Neo4j, Memgraph, ...)
 * register the same way under their own `kind`.
 *
 * The per-workspace path scheme `<workspace>/.braid/model.kuzu` is
 * Kuzu-specific (a directory of native files, not a hostname). Other
 * storage plugins compute their own location from the descriptor's
 * `config`.
 */
export const kuzuStoragePlugin: StoragePlugin = defineStoragePlugin({
  kind: KUZU_KIND,
  configSchema: KuzuStorageConfig,
  createModelRepository: async (_config, _descriptor, context) => {
    return new KuzuModelRepository({
      resolveDbPath: async (workspaceId: WorkspaceId) => {
        const root = await context.resolveWorkspaceRoot(workspaceId)
        return join(root, '.braid', 'model.kuzu')
      },
    })
  },
})

export { KUZU_KIND }
