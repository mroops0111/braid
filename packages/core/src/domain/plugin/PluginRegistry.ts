import type {
  AgentKind,
  LoaderKind,
  OntologyId,
  PluginId,
  PluginType,
  SkillId,
  StorageKind,
  ViewKind,
} from '@braidhq/schema'
import type { AgentPlugin } from './AgentPlugin.js'
import type { ViewGeneratorPlugin } from './Generator.js'
import type { OntologyPlugin } from './Ontology.js'
import type { Plugin, PluginReferenceDirRef, PluginSkillRef } from './Plugin.js'
import type { SourceLoaderPlugin } from './SourceLoader.js'
import type { StoragePlugin } from './StoragePlugin.js'
import { ConflictError, NotFoundError } from '../errors.js'

/** PluginSkillRef enriched with the id of the plugin that contributed it. */
export interface PluginSourcedSkill extends PluginSkillRef {
  readonly contributedBy: PluginId
}

/** PluginReferenceDirRef enriched with the id of the plugin that contributed it. */
export interface PluginSourcedReferenceDir extends PluginReferenceDirRef {
  readonly contributedBy: PluginId
}

export class PluginRegistry {
  private readonly plugins = new Map<PluginId, Plugin>()
  private readonly skillContributors = new Map<SkillId, PluginId>()

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new ConflictError(`Plugin "${plugin.id}" is already registered`)
    }
    // Catch skill-id collisions across plugins at register time so the
    // failure points at the second plugin to register, not at some
    // later workspace.list() call.
    for (const skill of plugin.skills ?? []) {
      const owner = this.skillContributors.get(skill.id)
      if (owner !== undefined)
        throw new ConflictError(`Skill "${skill.id}" already contributed by plugin "${owner}"`)
      this.skillContributors.set(skill.id, plugin.id)
    }
    this.plugins.set(plugin.id, plugin)
  }

  /**
   * All skills declared by registered plugins, tagged with the plugin
   * id that contributed each. Consumers (FsSkillRegistry) mount these
   * under the `plugin` skill origin.
   */
  pluginSkills(): readonly PluginSourcedSkill[] {
    const result: PluginSourcedSkill[] = []
    for (const plugin of this.plugins.values()) {
      for (const skill of plugin.skills ?? [])
        result.push({ ...skill, contributedBy: plugin.id })
    }
    return result
  }

  /**
   * All reference directories declared by registered plugins, tagged
   * with the plugin id that contributed each. Consumers
   * (SubprocessSkillRunner) symlink these into every spawned skill
   * session so SKILL.md authors can reference plugin-owned concept
   * docs via a stable cwd-relative path.
   */
  pluginReferenceDirs(): readonly PluginSourcedReferenceDir[] {
    const result: PluginSourcedReferenceDir[] = []
    for (const plugin of this.plugins.values()) {
      for (const dir of plugin.referenceDirs ?? [])
        result.push({ ...dir, contributedBy: plugin.id })
    }
    return result
  }

  has(pluginId: PluginId): boolean {
    return this.plugins.has(pluginId)
  }

  list(): readonly Plugin[] {
    return [...this.plugins.values()]
  }

  listByType(pluginType: PluginType): readonly Plugin[] {
    return this.list().filter(plugin => plugin.type === pluginType)
  }

  ontologies(): readonly OntologyPlugin[] {
    return this.listByType('ontology') as readonly OntologyPlugin[]
  }

  findOntology(ontologyId: OntologyId): OntologyPlugin | undefined {
    return this.ontologies().find(ontology => ontology.ontologyId === ontologyId)
  }

  requireOntology(ontologyId: OntologyId): OntologyPlugin {
    const ontology = this.findOntology(ontologyId)
    if (!ontology)
      throw new NotFoundError(`Ontology "${ontologyId}" not registered`)
    return ontology
  }

  viewGenerators(): readonly ViewGeneratorPlugin[] {
    return this.listByType('view-generator') as readonly ViewGeneratorPlugin[]
  }

  findViewGenerator(viewKind: ViewKind): ViewGeneratorPlugin | undefined {
    return this.viewGenerators().find(generator => generator.viewKind === viewKind)
  }

  requireViewGenerator(viewKind: ViewKind): ViewGeneratorPlugin {
    const generator = this.findViewGenerator(viewKind)
    if (!generator)
      throw new NotFoundError(`No view generator registered for viewKind "${viewKind}"`)
    return generator
  }

  agentPlugins(): readonly AgentPlugin[] {
    return this.listByType('agent') as readonly AgentPlugin[]
  }

  findAgentPlugin(kind: AgentKind): AgentPlugin | undefined {
    return this.agentPlugins().find(plugin => plugin.kind === kind)
  }

  requireAgentPlugin(kind: AgentKind): AgentPlugin {
    const plugin = this.findAgentPlugin(kind)
    if (!plugin)
      throw new NotFoundError(`No agent plugin registered for kind "${kind}"`)
    return plugin
  }

  storagePlugins(): readonly StoragePlugin[] {
    return this.listByType('storage') as readonly StoragePlugin[]
  }

  findStoragePlugin(kind: StorageKind): StoragePlugin | undefined {
    return this.storagePlugins().find(plugin => plugin.kind === kind)
  }

  requireStoragePlugin(kind: StorageKind): StoragePlugin {
    const plugin = this.findStoragePlugin(kind)
    if (!plugin)
      throw new NotFoundError(`No storage plugin registered for kind "${kind}"`)
    return plugin
  }

  sourceLoaders(): readonly SourceLoaderPlugin[] {
    return this.listByType('source-loader') as readonly SourceLoaderPlugin[]
  }

  findSourceLoader(kind: LoaderKind): SourceLoaderPlugin | undefined {
    return this.sourceLoaders().find(loader => loader.kind === kind)
  }

  requireSourceLoader(kind: LoaderKind): SourceLoaderPlugin {
    const loader = this.findSourceLoader(kind)
    if (!loader)
      throw new NotFoundError(`No source loader registered for kind "${kind}"`)
    return loader
  }
}
