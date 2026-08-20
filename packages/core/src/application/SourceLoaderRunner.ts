import type {
  AbsolutePath,
  FilesystemSourceDescriptor,
  SourceId,
  SourceLoaderDescriptor,
} from '@braidhq/schema'
import type { Clock } from '../domain/Clock.js'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import type { ProvisionReport, SyncReport } from '../domain/plugin/SourceLoaderPlugin.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { WorkspaceEventBus } from './WorkspaceEventBus.js'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { AbsolutePath as AbsolutePathSchema } from '@braidhq/schema'
import { NotFoundError, ValidationError } from '../domain/errors.js'

export interface SourceLoaderRunnerDeps {
  readonly pluginRegistry: PluginRegistry
  readonly clock: Clock
  /** Optional pub/sub for Studio invalidation. See HITLService for the pattern. */
  readonly eventBus?: WorkspaceEventBus
}

/**
 * Runs `SourceLoader.provision` / `.sync`,
 * for a workspace's loader-backed filesystem sources.
 * Sources without a loader, or that aren't filesystem-kind, are a no-op.
 *
 * Two entry points:
 *   - `provisionAll` runs at workspace scaffold / source add time.
 *   - `syncOne` runs when the user clicks the source's "Sync" button,
 *     or a scheduler triggers a refresh.
 *
 * Both are pure provisioning.
 * They materialise files under each source's configured `path`,
 * and do not touch the Knowledge Graph.
 */
export class SourceLoaderRunner {
  constructor(private readonly deps: SourceLoaderRunnerDeps) {}

  async provisionAll(workspace: Workspace): Promise<readonly ProvisionOutcome[]> {
    const outcomes: ProvisionOutcome[] = []
    for (const source of workspace.filesystemSources()) {
      if (!source.loader)
        continue
      const report = await this.runProvision(workspace, source, source.loader)
      outcomes.push({ sourceId: source.id, report })
      this.deps.eventBus?.publish({
        type: 'source.synced',
        workspaceId: workspace.id,
        sourceId: source.id,
        changed: true,
        at: this.deps.clock.now(),
      })
    }
    return outcomes
  }

  async syncOne(workspace: Workspace, sourceId: SourceId): Promise<SyncReport> {
    const source = workspace.filesystemSources().find(candidate => candidate.id === sourceId)
    if (!source)
      throw new NotFoundError(`Filesystem source "${sourceId}" not found in workspace "${workspace.id}"`)
    if (!source.loader)
      throw new ValidationError(`Source "${sourceId}" has no loader; nothing to sync`)
    const loader = this.deps.pluginRegistry.requireSourceLoader(source.loader.kind)
    const context = { workspaceId: workspace.id, sourceId: source.id }
    const destination = resolveSourcePath(workspace, source)
    // If the destination doesn't exist yet, the first run after register,
    // fall back to provision.
    // The user's intent for "sync" is "make this source current",
    // whether that's a fresh clone or a pull is plumbing.
    if (!(await pathExists(destination))) {
      const provision = await loader.provision(source.loader.config, destination, context)
      const report: SyncReport = {
        changed: true,
        ...(provision.revision === undefined ? {} : { revision: provision.revision }),
        ...(provision.metadata ? { metadata: provision.metadata } : {}),
        fetchedAt: provision.fetchedAt,
      }
      this.publishSynced(workspace, source.id, report)
      return report
    }
    if (!loader.sync)
      throw new ValidationError(`Loader "${source.loader.kind}" does not support sync and destination already exists`)
    const report = await loader.sync(source.loader.config, destination, context)
    this.publishSynced(workspace, source.id, report)
    return report
  }

  private publishSynced(workspace: Workspace, sourceId: SourceId, report: SyncReport): void {
    this.deps.eventBus?.publish({
      type: 'source.synced',
      workspaceId: workspace.id,
      sourceId,
      changed: report.changed,
      at: this.deps.clock.now(),
    })
  }

  private async runProvision(
    workspace: Workspace,
    source: FilesystemSourceDescriptor,
    loader: SourceLoaderDescriptor,
  ): Promise<ProvisionReport> {
    const plugin = this.deps.pluginRegistry.requireSourceLoader(loader.kind)
    return plugin.provision(loader.config, resolveSourcePath(workspace, source), {
      workspaceId: workspace.id,
      sourceId: source.id,
    })
  }
}

export interface ProvisionOutcome {
  readonly sourceId: SourceId
  readonly report: ProvisionReport
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  }
  catch {
    return false
  }
}

/**
 * PRODUCT.md `sources[].path` can be relative, e.g. `./intent`, or absolute.
 * Loaders need an absolute path to operate on.
 * Relative paths are resolved against the workspace's `rootPath`.
 */
function resolveSourcePath(workspace: Workspace, source: FilesystemSourceDescriptor): AbsolutePath {
  if (isAbsolute(source.path))
    return source.path
  return AbsolutePathSchema.parse(resolve(workspace.rootPath, source.path))
}
