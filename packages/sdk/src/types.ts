import type { SkillId } from '@braidhq/schema'

/**
 * Reference to a SKILL.md file shipped alongside a plugin. The plugin's
 * `define*` builder records these on the resulting Plugin instance; at
 * runtime FsSkillRegistry walks the registered plugins and exposes
 * their skills under the `plugin` origin. Letting any Plugin type (not
 * just Ontology) declare skills keeps the framework open for skills
 * that are tied to a source loader, a validator, or a future plugin
 * kind without changing the base interface again.
 */
export interface PluginSkillRef {
  readonly id: SkillId
  /**
   * Filesystem location of the SKILL.md directory's parent (i.e. the
   * directory that *contains* `SKILL.md`). A `URL` is accepted so
   * plugin authors can write `new URL('../skills/foo', import.meta.url)`
   * and have it resolve correctly both in source and after publish.
   */
  readonly directory: URL | string
}

/**
 * Reference to a *shared reference* directory the plugin contributes
 * to every spawned skill session. The skill runner symlinks the
 * directory under `<session>/.claude/skills/<name>/` so SKILL.md files
 * can `Read <cwd>/.claude/skills/<name>/<file>.md` from any skill,
 * regardless of which one spawned the session.
 *
 * The intended use is ontology- or domain-level concept docs: content
 * that defines the *vocabulary and rules* the plugin's skills assume,
 * which would otherwise be duplicated across each SKILL.md.
 *
 * `name` becomes a subdirectory under `.claude/skills/`, so pick
 * something stable and namespaced (e.g. `ontology-ddd`, not just
 * `shared`).
 */
export interface PluginReferenceDirRef {
  readonly name: string
  readonly directory: URL | string
}
