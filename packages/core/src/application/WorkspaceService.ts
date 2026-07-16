import type { AbsolutePath, WorkspaceId } from '@braidhq/schema'
import type { PluginRegistry } from '../domain/plugin/PluginRegistry.js'
import type { Workspace } from '../domain/workspace/Workspace.js'
import type { WorkspaceRepository } from '../domain/workspace/WorkspaceRepository.js'
import { NotFoundError, ValidationError } from '../domain/errors.js'

export interface WorkspaceServiceDeps {
  workspaceRepository: WorkspaceRepository
  pluginRegistry: PluginRegistry
}

export class WorkspaceService {
  constructor(private readonly deps: WorkspaceServiceDeps) {}

  async list(): Promise<Workspace[]> {
    return this.deps.workspaceRepository.list()
  }

  async load(rootPath: AbsolutePath): Promise<Workspace> {
    return this.deps.workspaceRepository.load(rootPath)
  }

  async save(workspace: Workspace): Promise<void> {
    return this.deps.workspaceRepository.save(workspace)
  }

  /**
   * Throw if the workspace's sources don't cover every role,
   * that the registered ontology declares as required.
   * Route handlers that mutate `sources` call this before `save()`,
   * on add, patch, or delete.
   * `save()` itself doesn't enforce the rule,
   * so discovery can re-load pre-existing workspaces whose manifests pre-date it.
   */
  assertRequiredSourceRoles(workspace: Workspace): void {
    const ontology = this.deps.pluginRegistry.findOntology(workspace.productManifest.ontologyId)
    const required = ontology?.requiredSourceRoles ?? []
    if (required.length === 0)
      return
    const present = new Set(workspace.sources.map(source => source.role))
    const missing = required.filter(role => !present.has(role))
    if (missing.length === 0)
      return
    throw new ValidationError(
      `Workspace requires source role${missing.length === 1 ? '' : 's'} ${missing.map(role => `"${role}"`).join(', ')} `
      + `for ontology "${workspace.productManifest.ontologyId}".`,
    )
  }

  async findById(workspaceId: WorkspaceId): Promise<Workspace> {
    const workspaces = await this.deps.workspaceRepository.list()
    const match = workspaces.find(workspace => workspace.id === workspaceId)
    if (!match)
      throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
    return match
  }

  async remove(rootPath: AbsolutePath): Promise<void> {
    return this.deps.workspaceRepository.remove(rootPath)
  }

  /**
   * Discard any cached parse so the next `load` re-reads from disk.
   * Call after rewriting PRODUCT.md, so subsequent reads pick up the new manifest.
   */
  invalidate(rootPath: AbsolutePath): void {
    this.deps.workspaceRepository.invalidate?.(rootPath)
  }
}
