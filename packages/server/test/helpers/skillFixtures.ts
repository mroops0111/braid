/**
 * SKILL.md fixtures for tests that materialise a real file on disk.
 *
 * The repo's `SkillStructureValidator` requires a fixed set of H2
 * sections per skill category; a SKILL.md missing one is rejected by
 * `FsSkillRegistry` at load time. Tests don't care about prose
 * content, they care that the structural contract is satisfied — so
 * we keep a single minimal-conforming body here that every test
 * fixture writer can reuse.
 *
 * When the structure contract evolves (a new required section, a new
 * category-specific section), update this helper and the existing
 * tests pick it up automatically.
 */

export interface MakeSkillFileOptions {
  readonly name: string
  readonly description?: string
  /** Skill category. Omit for the Custom-bucket (no `braid.category`) shape. */
  readonly category?: 'ask' | 'build' | 'generate'
}

/**
 * Returns a complete SKILL.md text (frontmatter + body) that passes
 * `SkillStructureValidator`. The body contains all required H2 sections
 * with one-line placeholder content.
 */
export function makeSkillFileContents(opts: MakeSkillFileOptions): string {
  const frontmatter = [
    '---',
    `name: ${opts.name}`,
    `description: ${opts.description ?? `${opts.name} skill (fixture)`}`,
    ...(opts.category ? ['braid:', `  category: ${opts.category}`] : []),
    '---',
  ].join('\n')

  const commonSections = [
    'Role',
    'Inputs & Outputs',
    'Design Principles',
    'Initialization',
    'Procedure',
    'Output',
    'Failure Handling',
    'Completion Checklist',
    'Companion docs',
  ]
  const categorySections = opts.category === 'generate' ? ['Output Files'] : []
  const sections = [...commonSections, ...categorySections]

  const body = sections.map(s => `## ${s}\n\nFixture body for ${s}.`).join('\n\n')

  return `${frontmatter}\n\n${body}\n`
}
