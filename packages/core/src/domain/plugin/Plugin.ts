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

/**
 * Pointer to a *shared reference* directory,
 * the plugin contributes it to every spawned skill session.
 * SubprocessSkillRunner symlinks the directory,
 * under `<session>/.claude/skills/<name>/`,
 * so any SKILL.md can read it regardless of which skill spawned the session.
 *
 * Use this for ontology / domain concept docs the plugin's skills assume,
 * instead of duplicating the content in every SKILL.md.
 * `name` becomes a subdirectory under `.claude/skills/`,
 * so pick a stable, namespaced value, e.g. `ontology-ddd`.
 */
export interface PluginReferenceDirRef {
  readonly name: string
  /**
   * Directory whose immediate contents get symlinked,
   * into `<session>/.claude/skills/<name>/`.
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
   * Required once `skills` is non-empty, the registry fails loudly otherwise.
   * An ontology plugin sets it to its `ontologyId`.
   */
  readonly skillNamespace?: string
  /**
   * Reference directories symlinked into every skill session,
   * under `<session>/.claude/skills/<name>/`.
   * Omitted when the plugin contributes none.
   */
  readonly referenceDirs?: readonly PluginReferenceDirRef[]
  initialize?: (context: PluginContext) => Promise<void>
  dispose?: () => Promise<void>
}
