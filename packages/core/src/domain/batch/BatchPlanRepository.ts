import type { Workspace } from '../workspace/Workspace.js'
import type { BatchPlan } from './BatchPlan.js'

export interface BatchPlanRepository {
  load: (workspace: Workspace) => Promise<BatchPlan | null>
  save: (workspace: Workspace, plan: BatchPlan) => Promise<void>
  clear: (workspace: Workspace) => Promise<void>
}
