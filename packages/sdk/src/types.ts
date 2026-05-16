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
