import type { RunRecord, SkillEvent, SkillRunId } from '@telos/schema'
import type { Workspace } from '../workspace/Workspace.js'

export interface RunRepository {
  saveRecord: (workspace: Workspace, record: RunRecord) => Promise<void>
  appendEvent: (workspace: Workspace, runId: SkillRunId, event: SkillEvent) => Promise<void>
  listRecords: (workspace: Workspace) => Promise<readonly RunRecord[]>
  readEvents: (workspace: Workspace, runId: SkillRunId) => AsyncIterable<SkillEvent>
}
