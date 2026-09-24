import type { SkillFrontmatter, SkillId } from '@braidhq/schema'
import { ValidationError } from '../errors.js'

/**
 * Holds a run to what its skill declared it needs, once the environment exists.
 *
 * This is the last of the three moments a skill is checked at,
 * and the first one at which `requiredEnv` can be answered at all.
 *
 * Most of what a shipped prompt names there is injected by the runner,
 * as it assembles the run,
 * so asking the same question of the server's own environment answers no every time,
 * and answers it wrongly.
 *
 * A fault here throws rather than being reported. The run is about to begin,
 * nothing yet exists for a reader to act on,
 * and a prompt that reads an unset variable spends a subscription,
 * discovering what this sentence could say.
 */
export function assertSkillCanStart(input: {
  readonly skillId: SkillId
  readonly frontmatter: SkillFrontmatter
  readonly env: Readonly<Record<string, string | undefined>>
}): void {
  const missing = input.frontmatter.braid.requiredEnv.filter(name => !input.env[name])
  if (missing.length === 0)
    return
  throw new ValidationError(
    `Skill "${input.skillId}" declares environment ${missing.map(name => `"${name}"`).join(', ')}, which this run does not have.`,
  )
}
