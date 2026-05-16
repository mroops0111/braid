import type { PluginId, PluginType, SkillId } from '@braidhq/schema'
import type { z } from 'zod'

export interface PluginLogger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export interface PluginContext {
  workspaceRootPath: string
  logger: PluginLogger
}

/**
 * Pointer to a SKILL.md directory shipped by a plugin. PluginRegistry
 * exposes these via `getPluginSkills()` so FsSkillRegistry can mount
 * them under the `plugin` skill-origin alongside builtin and workspace
 * skills. Declaring `skills` on the base Plugin interface (not just
 * on Ontology) keeps the framework open to plugins of other types
 * (source-loader, validator, future) that want to ship a companion
 * skill without us widening the base interface again.
 */
export interface PluginSkillRef {
  readonly id: SkillId
  /** Directory that contains `SKILL.md`. `URL` accepted so plugin authors can write `new URL('../skills/foo', import.meta.url)`. */
  readonly directory: URL | string
}

export interface Plugin {
  readonly id: PluginId
  readonly type: PluginType
  readonly configSchema: z.ZodSchema
  /** Skills shipped by this plugin. Optional; omit when the plugin contributes none. */
  readonly skills?: readonly PluginSkillRef[]
  initialize?: (context: PluginContext) => Promise<void>
  dispose?: () => Promise<void>
}
