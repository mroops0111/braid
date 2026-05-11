import type {
  AbsolutePath,
  CodeRef,
  IntentRef,
  PluginConfig,
  ProductManifest,
  Workspace as WorkspaceData,
  WorkspaceId,
} from '@telos/schema'
import { NotFoundError } from '../errors.js'

export class Workspace {
  constructor(private readonly data: WorkspaceData) {}

  get id(): WorkspaceId { return this.data.id }
  get rootPath(): AbsolutePath { return this.data.rootPath }
  get productManifest(): ProductManifest { return this.data.productManifest }
  get pluginConfig(): PluginConfig { return this.data.pluginConfig }
  get codeRefs(): CodeRef[] { return this.data.codeRefs }
  get intentRefs(): IntentRef[] { return this.data.intentRefs }

  resolveAgentForTask(taskName: string): string {
    const tasks = this.data.productManifest.agents.tasks
    return tasks[taskName] ?? this.data.productManifest.agents.default
  }

  findCodeRef(name: string): CodeRef | undefined {
    return this.data.codeRefs.find(reference => reference.name === name)
  }

  findIntentRef(name: string): IntentRef | undefined {
    return this.data.intentRefs.find(reference => reference.name === name)
  }

  requireCodeRef(name: string): CodeRef {
    const reference = this.findCodeRef(name)
    if (!reference)
      throw new NotFoundError(`CodeRef "${name}" not found in workspace`)
    return reference
  }

  requireIntentRef(name: string): IntentRef {
    const reference = this.findIntentRef(name)
    if (!reference)
      throw new NotFoundError(`IntentRef "${name}" not found in workspace`)
    return reference
  }

  toData(): WorkspaceData {
    return this.data
  }
}
