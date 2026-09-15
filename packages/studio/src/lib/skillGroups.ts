import type { SkillCategory, SkillManifest } from '@braidhq/schema'

/**
 * Schema `SkillCategory` maps 1:1 to a group.
 * Skills with no category land in "Custom",
 * which is for workspace one-offs and plugin skills,
 * that do not fit the canonical workflow.
 */
export type Group = SkillCategory | 'custom'

export function bucketByGroup(skills: readonly SkillManifest[]): Record<Group, SkillManifest[]> {
  const out: Record<Group, SkillManifest[]> = { ask: [], build: [], generate: [], custom: [] }
  for (const skill of skills) {
    const category = skill.frontmatter.braid?.category
    // An ask skill has its own surface,
    // with the question box and the answers that came out of it.
    // Listing it here too offers the same run twice,
    // and the copy here is the poorer of the two.
    if (category === 'ask')
      continue
    out[category ?? 'custom'].push(skill)
  }
  // Sort the Build group by `order` so the numbered steps line up,
  // with the workflow.
  // Sparse numbering (100, 200, 300 by convention),
  // lets plugins slot between built-ins by picking e.g. 150,
  // without anyone renumbering.
  // The UI displays sequential rank (1, 2, 3),
  // so users never see the raw sort keys.
  out.build.sort((a, b) => {
    const ao = a.frontmatter.braid?.order ?? Number.POSITIVE_INFINITY
    const bo = b.frontmatter.braid?.order ?? Number.POSITIVE_INFINITY
    return ao - bo
  })
  return out
}
