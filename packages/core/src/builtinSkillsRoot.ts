import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Absolute path to the directory containing built-in `SKILL.md` files
 * shipped with `@telos/core`. `here` is either `<core>/src` (dev / tsx) or
 * `<core>/dist` (after `pnpm build`); either way, `<core>/skills` is one
 * level up.
 */
export const builtinSkillsRoot = resolve(here, '..', 'skills')
