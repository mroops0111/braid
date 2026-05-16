import type {
  AgentKind,
  ChannelKind,
  LoaderKind,
  OntologyId,
  PluginId,
  PluginType,
  SkillId,
  StorageKind,
  ViewKind,
} from '@telos/schema'
import type { AgentPlugin } from './AgentPlugin.js'
import type { ChannelPlugin } from './ChannelPlugin.js'
import type { Generator } from './Generator.js'
import type { Ontology } from './Ontology.js'
import type { Plugin, PluginSkillRef } from './Plugin.js'
import type { SourceLoader } from './SourceLoader.js'
import type { StoragePlugin } from './StoragePlugin.js'
import type { Validator } from './Validator.js'
import { ConflictError, NotFoundError } from '../errors.js'

/** PluginSkillRef enriched with the id of the plugin that contributed it. */
export interface PluginSourcedSkill extends PluginSkillRef {
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

  has(pluginId: PluginId): boolean {
    return this.plugins.has(pluginId)
  }

  list(): readonly Plugin[] {
    return [...this.plugins.values()]
  }

  listByType(pluginType: PluginType): readonly Plugin[] {
    return this.list().filter(plugin => plugin.type === pluginType)
  }

  ontologies(): readonly Ontology[] {
    return this.listByType('ontology') as readonly Ontology[]
  }

  findOntology(ontologyId: OntologyId): Ontology | undefined {
    return this.ontologies().find(ontology => ontology.ontologyId === ontologyId)
  }

  requireOntology(ontologyId: OntologyId): Ontology {
    const ontology = this.findOntology(ontologyId)
    if (!ontology)
      throw new NotFoundError(`Ontology "${ontologyId}" not registered`)
    return ontology
  }

  validators(): readonly Validator[] {
    return this.listByType('validator') as readonly Validator[]
  }

  generators(): readonly Generator[] {
    return this.listByType('generator') as readonly Generator[]
  }

  findGenerator(viewKind: ViewKind): Generator | undefined {
    return this.generators().find(generator => generator.viewKind === viewKind)
  }

  requireGenerator(viewKind: ViewKind): Generator {
    const generator = this.findGenerator(viewKind)
    if (!generator)
      throw new NotFoundError(`No generator registered for viewKind "${viewKind}"`)
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

  sourceLoaders(): readonly SourceLoader[] {
    return this.listByType('source-loader') as readonly SourceLoader[]
  }

  findSourceLoader(kind: LoaderKind): SourceLoader | undefined {
    return this.sourceLoaders().find(loader => loader.kind === kind)
  }

  requireSourceLoader(kind: LoaderKind): SourceLoader {
    const loader = this.findSourceLoader(kind)
    if (!loader)
      throw new NotFoundError(`No source loader registered for kind "${kind}"`)
    return loader
  }

  channelPlugins(): readonly ChannelPlugin[] {
    return this.listByType('channel') as readonly ChannelPlugin[]
  }

  findChannelPlugin(kind: ChannelKind): ChannelPlugin | undefined {
    return this.channelPlugins().find(plugin => plugin.kind === kind)
  }

  requireChannelPlugin(kind: ChannelKind): ChannelPlugin {
    const plugin = this.findChannelPlugin(kind)
    if (!plugin)
      throw new NotFoundError(`No channel plugin registered for kind "${kind}"`)
    return plugin
  }
}
