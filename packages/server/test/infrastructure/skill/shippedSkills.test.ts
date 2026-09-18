import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validateSkillFile } from '@braidhq/core'
import { SkillFrontmatter } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { parseMarkdownFrontmatter } from '../../../src/infrastructure/_shared/frontmatter.js'

const repoRoot = resolve(__dirname, '../../../../..')

/** Every SKILL.md this repo ships, whichever package owns it. */
function shippedSkills(): Array<{ id: string, file: string }> {
  const found: Array<{ id: string, file: string }> = []
  for (const pkg of readdirSync(join(repoRoot, 'packages'))) {
    const skillsDir = join(repoRoot, 'packages', pkg, 'skills')
    if (!existsSync(skillsDir))
      continue
    for (const verb of readdirSync(skillsDir)) {
      const file = join(skillsDir, verb, 'SKILL.md')
      if (existsSync(file))
        found.push({ id: `${pkg}/${verb}`, file })
    }
  }
  return found
}

/**
 * The contract holds for the prompts this repo publishes, not only for fixtures.
 *
 * A builtin or plugin skill that breaks it stops the server at boot,
 * which is a slow and confusing way to learn that a section was renamed.
 */
describe('shipped skills', () => {
  const skills = shippedSkills()

  it('finds the skills to check', () => {
    expect(skills.length).toBeGreaterThan(0)
  })

  it.each(skills)('$id is a usable skill', ({ file }) => {
    const { frontmatter: raw, body } = parseMarkdownFrontmatter<unknown>(readFileSync(file, 'utf-8'))
    const result = validateSkillFile({ body, frontmatter: SkillFrontmatter.parse(raw) })
    expect(result.issues.map(issue => issue.message)).toEqual([])
  })
})
