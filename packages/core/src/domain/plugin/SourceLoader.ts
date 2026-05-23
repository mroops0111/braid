import type { AbsolutePath, LoaderKind, SourceId, Timestamp, WorkspaceId } from '@braidhq/schema'
import type { Plugin } from './Plugin.js'

/**
 * Per-call context passed to a loader. Lets loaders look up per-source
 * state (OAuth tokens, sync cursors) keyed by `(workspaceId, sourceId)`
 * without those values leaking into the descriptor's `config`. Loaders
 * that don't need it can ignore it.
 */
export interface SourceLoaderContext {
  readonly workspaceId: WorkspaceId
  readonly sourceId: SourceId
}

export interface IngestReport {
  /** Local path where the source content now lives (under destination). */
  readonly localPath: AbsolutePath
  /** Loader-specific provenance metadata (commit sha, Drive revision, …). */
  readonly metadata?: Readonly<Record<string, unknown>>
  /** When the ingest completed. */
  readonly fetchedAt: Timestamp
}

export interface SyncReport {
  /** Whether the local content actually changed. */
  readonly changed: boolean
  /**
   * Per-file counts. Optional because some loaders can't compute them
   * cheaply (e.g. a future S3 loader that only checks an ETag). When
   * present, the UI shows a `+a ~u -r` style summary uniformly across
   * loaders. `changed` MUST equal `added + updated + removed > 0`
   * whenever any of these are set.
   */
  readonly added?: number
  readonly updated?: number
  readonly removed?: number
  readonly unchanged?: number
  /** Loader-specific provenance metadata after the sync (commit sha, Drive revision, …). */
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly fetchedAt: Timestamp
}

/**
 * Provisioner plugin for a `FilesystemSourceDescriptor`. The loader's job is
 * to fill `destination` with content drawn from somewhere external (git
 * remote, Google Drive folder, S3 prefix, …) so claude can later read the
 * files via `--add-dir`.
 *
 * `ingest` runs once at workspace scaffold / source-add time; `sync` is
 * triggered by the user (or by a future scheduler) to refresh. Loaders that
 * can't refresh in place may omit `sync`.
 *
 * Loaders are pure provisioners; they MUST NOT touch the Knowledge Graph
 * directly. They only write files. The `ingest`/`sync` contract is:
 *
 *  - The plugin owns the contents of `destination`. It MAY clear it before
 *    writing. The user agreed when they picked this loader.
 *  - The plugin MUST NOT write outside `destination`.
 *  - Errors thrown propagate as `ValidationError` to the user.
 */
export interface SourceLoaderPlugin extends Plugin {
  readonly type: 'source-loader'
  readonly kind: LoaderKind

  ingest: (config: unknown, destination: AbsolutePath, context: SourceLoaderContext) => Promise<IngestReport>
  sync?: (config: unknown, destination: AbsolutePath, context: SourceLoaderContext) => Promise<SyncReport>
}
