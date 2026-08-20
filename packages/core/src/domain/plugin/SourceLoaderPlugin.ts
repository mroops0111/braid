import type { AbsolutePath, LoaderKind, SourceId, Timestamp, WorkspaceId } from '@braidhq/schema'
import type { Plugin } from './Plugin.js'

/**
 * Per-call context passed to a loader.
 * Lets loaders look up per-source state, e.g. OAuth tokens or sync cursors,
 * keyed by `(workspaceId, sourceId)`,
 * without those values leaking into the descriptor's `config`.
 * Loaders that don't need it can ignore it.
 */
export interface SourceLoaderContext {
  readonly workspaceId: WorkspaceId
  readonly sourceId: SourceId
}

export interface ProvisionReport {
  /** Local path where the source content now lives (under destination). */
  readonly localPath: AbsolutePath
  /**
   * Opaque marker for the upstream state this pass landed on,
   * e.g. a commit sha. The framework only stores and displays it,
   * never parses it, so a loader with no such concept leaves it unset.
   * Distinct from `metadata`, which stays loader-specific and unread.
   */
  readonly revision?: string
  /** Loader-specific provenance metadata, e.g. a commit sha or Drive revision. */
  readonly metadata?: Readonly<Record<string, unknown>>
  /** When the provision completed. */
  readonly fetchedAt: Timestamp
}

export interface SyncReport {
  /** Whether the local content actually changed. */
  readonly changed: boolean
  /**
   * Per-file counts. Optional because some loaders can't compute them cheaply,
   * e.g. a future S3 loader that only checks an ETag.
   * When present, the UI shows a `+a ~u -r` style summary across loaders.
   * `changed` MUST equal `added + updated + removed > 0` when any are set.
   */
  readonly added?: number
  readonly updated?: number
  readonly removed?: number
  readonly unchanged?: number
  /** Opaque marker for the upstream state this sync landed on. See `ProvisionReport.revision`. */
  readonly revision?: string
  /** Loader-specific provenance after the sync, e.g. a commit sha or Drive revision. */
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly fetchedAt: Timestamp
}

/**
 * Provisioner plugin for a `FilesystemSourceDescriptor`.
 * The loader fills `destination` with content drawn from somewhere external,
 * e.g. a git remote, Google Drive folder, or S3 prefix,
 * so claude can later read the files via `--add-dir`.
 *
 * `provision` runs once at workspace scaffold / source-add time.
 * `sync` is triggered by the user, or by a future scheduler, to refresh.
 * Loaders that can't refresh in place may omit `sync`.
 *
 * Loaders are pure provisioners.
 * They MUST NOT touch the Knowledge Graph directly, they only write files.
 * The `provision`/`sync` contract is:
 *
 *  - The plugin owns the contents of `destination`.
 *    It MAY clear it before writing, the user agreed by picking this loader.
 *  - The plugin MUST NOT write outside `destination`.
 *  - Errors thrown propagate as `ValidationError` to the user.
 */
export interface SourceLoaderPlugin extends Plugin {
  readonly type: 'source-loader'
  readonly kind: LoaderKind

  provision: (config: unknown, destination: AbsolutePath, context: SourceLoaderContext) => Promise<ProvisionReport>
  sync?: (config: unknown, destination: AbsolutePath, context: SourceLoaderContext) => Promise<SyncReport>

  /**
   * What this loader contributes to push-based refresh.
   * Two questions, both answerable without knowing which platform sends it.
   * First, where its content lives, so a delivery can be matched to a source.
   * Second, whether an event changes this loader's content at all,
   * since a push matters to a code mirror and not to an issues loader.
   * Verifying the delivery is not here. That is the receiver's job.
   */
  readonly webhook?: WebhookCapability
}

/**
 * Where a source's content comes from, read off its own config.
 * Host-neutral on purpose.
 * Naming a platform here would put an integration detail in the kernel,
 * and would stop one loader serving two hosts, which a git remote does.
 *
 * Whoever receives a notification decides which hosts it can speak for.
 */
export interface SourceUpstream {
  /** Hostname of the remote, lowercased, e.g. `github.com`. */
  readonly host: string
  /** Path identifying the resource on that host, e.g. `owner/repo`. */
  readonly path: string
}

/**
 * A delivery the receiver has already authenticated and matched to a source.
 * `payload` is still the platform's own shape,
 * so a loader reading it is coupled to that platform.
 * Normalising it is tracked separately.
 */
export interface WebhookDelivery {
  /** Provider header value, e.g. `push`, `issues`, `issue_comment`, `ping`. */
  readonly event: string
  /** Parsed payload JSON. Loaders read provider-specific fields off this. */
  readonly payload: unknown
}

export interface WebhookCapability {
  /**
   * Where this source's content lives, parsed from its own config,
   * and nothing else. Return `undefined` when the config names no remote.
   * The receiver matches a delivery against this, and rejects a mismatch.
   */
  readonly upstream: (config: unknown) => SourceUpstream | undefined
  /**
   * Decide whether a verified delivery should actually fire `syncOne`.
   * Default `() => true` lets every verified delivery through.
   * Loaders narrow this to avoid wasted fetches,
   * e.g. a `push` to a ref the loader does not track.
   * Returning `false` keeps the receiver's 202 response,
   * so GitHub does not back off retries.
   */
  readonly shouldDispatch?: (config: unknown, delivery: WebhookDelivery) => boolean
}
