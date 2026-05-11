import type { GraphOperation, ModelSnapshot, WorkspaceId } from '@telos/schema'
import { Model, type ModelRepository } from '../../src/index.js'

export class InMemoryModelRepository implements ModelRepository {
  private models = new Map<WorkspaceId, Model>()

  async load(workspaceId: WorkspaceId): Promise<ModelSnapshot> {
    const model = this.models.get(workspaceId) ?? new Model()
    this.models.set(workspaceId, model)
    return model.toSnapshot()
  }

  async applyOperations(workspaceId: WorkspaceId, operations: GraphOperation[]): Promise<void> {
    const model = this.models.get(workspaceId) ?? new Model()
    model.applyOperations(operations)
    this.models.set(workspaceId, model)
  }
}
