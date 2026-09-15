import type { SessionShare } from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

/**
 * Who, besides its author, may read a conversation.
 *
 * Access control rather than run recording,
 * so it sits beside `RunRepository` instead of inside it.
 * A caller that only reads transcripts never depends on the grant methods,
 * and a caller that only grants never depends on the event stream.
 */
export interface SessionShareRepository {
  /**
   * Upsert one person's read access to one conversation.
   * Append-only with last-wins semantics keyed on `sessionId` and `grantee`,
   * so a withdrawal is a record carrying `revokedAt` rather than a deletion.
   */
  saveSessionShare: (workspace: Workspace, share: SessionShare) => Promise<void>
  /** Every grant ever made, withdrawn ones included. Callers filter. */
  listSessionShares: (workspace: Workspace) => Promise<readonly SessionShare[]>
  /**
   * Hard-delete every grant naming a session, withdrawn ones included.
   * Deleting a conversation destroys its records and its logs,
   * so a grant pointing at it would outlive everything it referred to.
   */
  deleteSessionShares: (workspace: Workspace, sessionId: string) => Promise<void>
}
