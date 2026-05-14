import type {
  FilesystemSourceDescriptor,
  SourceId,
  SourceLoaderDescriptor,
} from '@telos/schema'
import type { Clock } from '../domain/Clock.js'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import type { IngestReport, SyncReport } from '../domain/plugin/SourceLoader.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import { NotFoundError, ValidationError } from '../domain/errors.js'

export interface SourceLoaderRunnerDeps {
  readonly pluginRegistry: PluginRegistry
  readonly clock: Clock
}

/**
 * Runs `SourceLoader.ingest` / `.sync` for a workspace's loader-backed
 * filesystem sources. Sources without a loader (or that aren't
 * filesystem-kind) are a no-op.
 *
 * Two entry points:
 *   - `ingestAll` runs at workspace scaffold / source add time.
 *   - `syncOne` runs when the user clicks the source's "Sync" button or a
 *     scheduler triggers a refresh.
 *
 * Both are pure provisioning: they materialise files under each source's
 * configured `path` and do not touch the Knowledge Graph.
 */
export class SourceLoaderRunner {
  constructor(private readonly deps: SourceLoaderRunnerDeps) {}

  async ingestAll(workspace: Workspace): Promise<readonly IngestOutcome[]> {
    const outcomes: IngestOutcome[] = []
    for (const source of workspace.filesystemSources()) {
      if (!source.loader)
        continue
      const report = await this.runIngest(workspace, source, source.loader)
      outcomes.push({ sourceId: source.id, report })
    }
    return outcomes
  }

  async syncOne(workspace: Workspace, sourceId: SourceId): Promise<SyncReport> {
    const source = workspace.filesystemSources().find(s => s.id === sourceId)
    if (!source)
      throw new NotFoundError(`Filesystem source "${sourceId}" not found in workspace "${workspace.id}"`)
    if (!source.loader)
      throw new ValidationError(`Source "${sourceId}" has no loader; nothing to sync`)
    const loader = this.deps.pluginRegistry.requireSourceLoader(source.loader.kind)
    if (!loader.sync)
      throw new ValidationError(`Loader "${source.loader.kind}" does not support sync`)
    return loader.sync(source.loader.config, source.path, {
      workspaceId: workspace.id,
      sourceId: source.id,
    })
  }

  private async runIngest(
    workspace: Workspace,
    source: FilesystemSourceDescriptor,
    loader: SourceLoaderDescriptor,
  ): Promise<IngestReport> {
    const plugin = this.deps.pluginRegistry.requireSourceLoader(loader.kind)
    return plugin.ingest(loader.config, source.path, {
      workspaceId: workspace.id,
      sourceId: source.id,
    })
  }
}

export interface IngestOutcome {
  readonly sourceId: SourceId
  readonly report: IngestReport
}
