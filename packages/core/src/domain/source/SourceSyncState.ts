import type {
  SourceId,
  SourceSyncPolicy,
  SourceSyncState as SourceSyncStateData,
  Timestamp,
  WorkspaceId,
} from '@braidhq/schema'

/**
 * What a source's recent sync attempts did, and whether it is current
 * enough to read. Transitions return a new instance, the caller persists it.
 */
export class SourceSyncState {
  constructor(private readonly data: SourceSyncStateData) {}

  static initial(workspaceId: WorkspaceId, sourceId: SourceId): SourceSyncState {
    return new SourceSyncState({ workspaceId, sourceId, consecutiveFailures: 0 })
  }

  get workspaceId(): WorkspaceId { return this.data.workspaceId }
  get sourceId(): SourceId { return this.data.sourceId }
  get lastAttemptAt(): Timestamp | undefined { return this.data.lastAttemptAt }
  get lastSuccessAt(): Timestamp | undefined { return this.data.lastSuccessAt }
  get revision(): string | undefined { return this.data.revision }
  get consecutiveFailures(): number { return this.data.consecutiveFailures }
  get lastError(): string | undefined { return this.data.lastError }

  /**
   * A source that has never synced is not fresh, so the first read pulls it.
   * A budget of zero would make everything stale, which the schema rules out.
   */
  isFreshAt(now: Timestamp, policy: SourceSyncPolicy): boolean {
    if (!this.data.lastSuccessAt)
      return false
    return Date.parse(now) - Date.parse(this.data.lastSuccessAt) < policy.maxStalenessMs
  }

  /** Milliseconds this source has gone without a successful sync, or undefined if it never has. */
  stalenessAt(now: Timestamp): number | undefined {
    if (!this.data.lastSuccessAt)
      return undefined
    return Date.parse(now) - Date.parse(this.data.lastSuccessAt)
  }

  recordSuccess(at: Timestamp, revision?: string): SourceSyncState {
    const { lastError: _dropped, ...rest } = this.data
    return new SourceSyncState({
      ...rest,
      lastAttemptAt: at,
      lastSuccessAt: at,
      consecutiveFailures: 0,
      ...(revision === undefined ? {} : { revision }),
    })
  }

  recordFailure(at: Timestamp, error: string): SourceSyncState {
    return new SourceSyncState({
      ...this.data,
      lastAttemptAt: at,
      consecutiveFailures: this.data.consecutiveFailures + 1,
      lastError: error,
    })
  }

  toData(): SourceSyncStateData {
    return this.data
  }
}
