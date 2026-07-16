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
   * Webhook integration. When defined, sources backed by this loader can receive,
   * and verify, webhook deliveries from the remote `repoIdentity` names.
   * The webhook route delegates two questions to the plugin.
   * First, which `(provider, owner, repo)` triple this source is bound to,
   * for matching `repository.full_name` in the payload.
   * Second, whether a verified delivery should fire `syncOne` for this source.
   * Adding a new loader extends the webhook surface without touching the route.
   */
  readonly webhook?: WebhookCapability
}

/**
 * Provider this server's webhook receiver knows how to verify today.
 * Future provider support, e.g. `gitlab` or `linear`, extends this union.
 * A new provider mounts a sibling receiver at `/webhooks/<provider>/...`.
 */
export type WebhookProvider = 'github'

export interface WebhookRepoIdentity {
  readonly provider: WebhookProvider
  readonly owner: string
  readonly repo: string
}

/**
 * Normalised view of a verified webhook delivery,
 * handed to a loader's `shouldDispatch`.
 * The receiver has already parsed JSON, verified the HMAC,
 * and confirmed `repository.full_name` matches `repoIdentity`.
 */
export interface WebhookDelivery {
  /** Provider header value, e.g. `push`, `issues`, `issue_comment`, `ping`. */
  readonly event: string
  /** Parsed payload JSON. Loaders read provider-specific fields off this. */
  readonly payload: unknown
}

export interface WebhookCapability {
  /**
   * Resolve the canonical `(provider, owner, repo)` this source is bound to.
   * Return `undefined` when the configured remote is not webhook-capable,
   * e.g. a `git` loader pointed at a self-hosted gitea instance.
   * The receiver rejects mismatches with 400.
   */
  readonly repoIdentity: (config: unknown) => WebhookRepoIdentity | undefined
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
