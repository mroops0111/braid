import type { RunRecord, SkillEvent, SkillRunId } from '@telos/schema'
import type { Workspace } from '../workspace/Workspace.js'

/**
 * Persists skill-run history for replay and conversation listing in the
 * Studio UI. The FS adapter writes append-only JSONL files under the
 * workspace's `artifacts/runs/` directory; future adapters can swap to
 * sqlite without touching application code.
 */
export interface RunRepository {
  /** Overwrites the index record for `runId` (last-write-wins). */
  saveRecord: (workspace: Workspace, record: RunRecord) => Promise<void>
  /** Appends a single SkillEvent to the run's event log. */
  appendEvent: (workspace: Workspace, runId: SkillRunId, event: SkillEvent) => Promise<void>
  /** Most-recent-first list of run summaries. */
  listRecords: (workspace: Workspace) => Promise<readonly RunRecord[]>
  /** Streams the full event log for a single run, in original order. */
  readEvents: (workspace: Workspace, runId: SkillRunId) => AsyncIterable<SkillEvent>
}

/**
 * Default no-op implementation used when run recording is not configured.
 * Calls succeed silently so the rest of the system stays functional.
 */
export const noopRunRepository: RunRepository = {
  async saveRecord() {},
  async appendEvent() {},
  async listRecords() {
    return []
  },
  async * readEvents() {},
}
