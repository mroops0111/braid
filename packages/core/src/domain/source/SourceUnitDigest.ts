import type { SourceId, SourceUnitSha } from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

/**
 * Computes a stable content fingerprint for one source unit on disk.
 * Separate from the repository because the hashing strategy is loader-specific.
 * A filesystem source walks the directory,
 * an MCP source might delegate to the server's etag.
 */
export interface SourceUnitDigest {
  computeSha: (
    workspace: Workspace,
    sourceId: SourceId,
    path: string,
  ) => Promise<SourceUnitSha>
}
