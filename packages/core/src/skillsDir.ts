import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where a package's `skills/` directory sits at run time.
 *
 * A bundler collapses each module into one file, and `import.meta.url` with it,
 * so the walk from a module up to its own package root stops leading anywhere.
 * Two packages that both ship a `shared/` would overwrite each other.
 *
 * So a bundle stages each package's skills under its own name,
 * and that layout is checked first. Unbundled, nothing is staged,
 * and the usual walk from the module to its package root applies.
 */
export function resolveSkillsDir(moduleUrl: string, packageName: string): string {
  const here = dirname(fileURLToPath(moduleUrl))
  const staged = join(here, 'skills', packageName)
  if (existsSync(staged))
    return staged
  return resolve(here, '..', 'skills')
}
