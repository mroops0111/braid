import type { ViewArtifact, ViewKind, WorkspaceId } from '@telos/schema'
import type { Generator } from '../domain/generation/Generator.js'
import type { ModelRepository } from '../domain/model/ModelRepository.js'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import { NotFoundError } from '../domain/errors.js'

export interface GenerationServiceDeps {
  pluginRegistry: PluginRegistry
  modelRepository: ModelRepository
}

export class GenerationService {
  constructor(private readonly deps: GenerationServiceDeps) {}

  async render(
    workspaceId: WorkspaceId,
    viewKind: ViewKind,
    config: unknown,
  ): Promise<ViewArtifact> {
    const generator = this.findGenerator(viewKind)
    const snapshot = await this.deps.modelRepository.load(workspaceId)
    return generator.render({ model: snapshot, config })
  }

  listAvailableViewKinds(): ViewKind[] {
    return this.deps.pluginRegistry.listByType('generator')
      .map(plugin => (plugin as unknown as Generator).viewKind)
  }

  private findGenerator(viewKind: ViewKind): Generator {
    const match = this.deps.pluginRegistry.listByType('generator')
      .find(plugin => (plugin as unknown as Generator).viewKind === viewKind)
    if (!match)
      throw new NotFoundError(`No generator registered for viewKind "${viewKind}"`)
    return match as unknown as Generator
  }
}
