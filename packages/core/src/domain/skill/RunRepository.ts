import type { RunRecord, SessionMetadata, SkillEvent, SkillRunId } from '@braidhq/schema'
import type { Workspace } from '../workspace/Workspace.js'

export interface RunRepository {
  saveRecord: (workspace: Workspace, record: RunRecord) => Promise<void>
  appendEvent: (workspace: Workspace, runId: SkillRunId, event: SkillEvent) => Promise<void>
  listRecords: (workspace: Workspace) => Promise<readonly RunRecord[]>
  readEvents: (workspace: Workspace, runId: SkillRunId) => AsyncIterable<SkillEvent>
  /**
   * Hard-delete the given run records: drop them from the index and rm
   * their per-run event files. Caller is expected to refuse deletion
   * for in-flight runs (no record-level lock exists at this layer).
   */
  deleteRecords: (workspace: Workspace, runIds: readonly SkillRunId[]) => Promise<void>
  /**
   * Upsert per-session reviewer metadata (title, future pin/colour).
   * Append-only with last-wins semantics keyed on `sessionId`.
   */
  saveSessionMetadata: (workspace: Workspace, metadata: SessionMetadata) => Promise<void>
  listSessionMetadata: (workspace: Workspace) => Promise<readonly SessionMetadata[]>
}
