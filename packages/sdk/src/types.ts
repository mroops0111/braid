/**
 * Reference to a SKILL.md file shipped alongside a plugin.
 * The plugin's `define*` builder records these on the Plugin instance,
 * and at runtime FsSkillRegistry walks the registered plugins,
 * exposing their skills under the `plugin` origin.
 *
 * Letting any Plugin type declare skills, not just Ontology,
 * keeps the framework open for skills tied to a source loader,
 * a validator, or a future plugin kind,
 * without changing the base interface again.
 */
export interface PluginSkillRef {
  /**
   * Filesystem location of the directory that *contains* `SKILL.md`.
   * The basename is the skill's verb.
   * The loader composes the id as `<plugin.skillNamespace>:<verb>`,
   * so an author never writes or forgets the namespace per skill.
   * A `URL` is accepted for `new URL('../skills/foo', import.meta.url)`,
   * so it resolves both in source and after publish.
   */
  readonly directory: URL | string
}

/**
 * A plugin's reference directory, holding docs its skills Read but never invoke,
 * typically the concept doc its SKILL.md files assume.
 * The runner mounts it under the plugin's own namespace,
 * and passes the absolute path in the environment, so no SKILL.md writes one.
 */
export type PluginReferenceDirRef = URL | string
