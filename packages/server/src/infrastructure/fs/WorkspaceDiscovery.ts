import type { WorkspaceService } from '@braidhq/core'
import type { AbsolutePath } from '@braidhq/schema'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from '@braidhq/core'

/**
 * Walk `<workspacesRoot>/*` and register with the WorkspaceService,
 * every subdirectory that owns a `PRODUCT.md`.
 * It is idempotent,
 * an already-registered workspace is a no-op against the FS registry.
 * We run it on server boot,
 * so CLI-created or hand-copied workspaces surface in Studio,
 * without any explicit `register` step.
 *
 * A per-entry error, a corrupt PRODUCT.md or bad permissions,
 * is logged and skipped.
 * The server must still come up,
 * so the user can fix the outlier and re-boot.
 */
export async function discoverCanonicalWorkspaces(
  workspacesRoot: AbsolutePath,
  workspaceService: WorkspaceService,
): Promise<void> {
  const log = createLogger('server').child({ mod: 'workspace-discovery' })
  let entries: string[]
  try {
    entries = await readdir(workspacesRoot)
  }
  catch (err) {
    // ENOENT on first boot is expected,
    // the dir is created lazily by the first scaffold.
    // Any other error, such as bad permissions, we log and continue.
    // The server still boots.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      log.warn({ err, workspacesRoot }, 'failed to read workspaces root')
    return
  }

  for (const entry of entries) {
    const rootPath = join(workspacesRoot, entry) as AbsolutePath
    try {
      const dirStat = await stat(rootPath)
      if (!dirStat.isDirectory())
        continue
      const manifestStat = await stat(join(rootPath, 'PRODUCT.md')).catch(() => undefined)
      if (!manifestStat?.isFile())
        continue
      const workspace = await workspaceService.load(rootPath)
      await workspaceService.save(workspace)
    }
    catch (err) {
      log.warn({ err, rootPath }, 'skipping unreadable workspace dir')
    }
  }
}
