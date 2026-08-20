import { resolveSkillsDir } from './skillsDir.js'

/**
 * Absolute path to the built-in `SKILL.md` files shipped with `@braidhq/core`.
 */
export const builtinSkillsRoot = resolveSkillsDir(import.meta.url, 'core')
