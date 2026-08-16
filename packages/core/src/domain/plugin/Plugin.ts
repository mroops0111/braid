import type { PluginId, PluginType } from '@braidhq/schema'
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
 * Pointer to a SKILL.md directory shipped by a plugin.
 * PluginRegistry exposes these via `getPluginSkills()`,
 * so FsSkillRegistry can mount them under the `plugin` skill-origin,
 * alongside builtin and workspace skills.
 * Declaring `skills` on the base Plugin interface, not just on Ontology,
 * keeps the framework open to plugins of other types,
 * e.g. source-loader, validator, or future kinds,
 * that want to ship a companion skill without widening the base interface.
 */
export interface PluginSkillRef {
  /**
   * Directory that contains `SKILL.md`.
   * The basename is the skill's verb.
   * The loader composes the id as `<plugin.skillNamespace>:<verb>`,
   * so an author never writes or forgets the namespace per skill.
   * A `URL` is accepted for `new URL('../skills/foo', import.meta.url)`.
   */
  readonly directory: URL | string
}

export interface Plugin {
  readonly id: PluginId
  readonly type: PluginType
  readonly configSchema: z.ZodSchema
  /** Skills shipped by this plugin, omitted when it contributes none. */
  readonly skills?: readonly PluginSkillRef[]
  /**
   * Namespace for this plugin's skill ids, composed as `<skillNamespace>:<verb>`.
   * Required once `skills` or `referenceDir` is set, the registry fails loudly otherwise.
   * An ontology plugin sets it to its `ontologyId`.
   */
  readonly skillNamespace?: string
  /**
   * Directory of reference docs this plugin's skills Read but never invoke,
   * such as an ontology concept doc.
   * The runner mounts it under `skillNamespace` and passes the absolute path,
   * so no SKILL.md carries a location of its own.
   * A `URL` is accepted for `new URL('../skills/shared', import.meta.url)`.
   */
  readonly referenceDir?: URL | string
  initialize?: (context: PluginContext) => Promise<void>
  dispose?: () => Promise<void>
}
