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
 * Reference to a shared reference directory the plugin contributes
 * to every spawned skill session.
 * The skill runner symlinks it under `<session>/.claude/skills/<name>/`,
 * so a SKILL.md can `Read <cwd>/.claude/skills/<name>/<file>.md`,
 * from any skill, regardless of which one spawned the session.
 *
 * The intended use is ontology- or domain-level concept docs,
 * content that defines the vocabulary and rules the plugin's skills assume,
 * which would otherwise be duplicated across each SKILL.md.
 *
 * `name` becomes a subdirectory under `.claude/skills/`,
 * so pick something stable and namespaced,
 * such as `ontology-ddd`, not just `shared`.
 */
export interface PluginReferenceDirRef {
  readonly name: string
  readonly directory: URL | string
}
