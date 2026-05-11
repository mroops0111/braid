import type { GraphOperation, ModelSnapshot, WorkspaceId } from '@telos/schema'

export interface ModelRepository {
  load: (workspaceId: WorkspaceId) => Promise<ModelSnapshot>
  applyOperations: (workspaceId: WorkspaceId, operations: GraphOperation[]) => Promise<void>
}
