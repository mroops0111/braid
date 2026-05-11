import type { PluginId, PluginType } from '@telos/schema'
import type { Plugin } from './Plugin.js'
import { ConflictError, NotFoundError } from '../errors.js'

export class PluginRegistry {
  private plugins = new Map<PluginId, Plugin>()

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new ConflictError(`Plugin "${plugin.id}" is already registered`)
    }
    this.plugins.set(plugin.id, plugin)
  }

  get<T extends Plugin = Plugin>(pluginId: PluginId): T {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) {
      throw new NotFoundError(`Plugin "${pluginId}" not found`)
    }
    return plugin as T
  }

  has(pluginId: PluginId): boolean {
    return this.plugins.has(pluginId)
  }

  listByType(pluginType: PluginType): Plugin[] {
    return [...this.plugins.values()].filter(plugin => plugin.type === pluginType)
  }

  list(): Plugin[] {
    return [...this.plugins.values()]
  }
}
