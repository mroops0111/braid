export interface MakeSkillFileOptions {
  readonly name: string
  readonly description?: string
  /** Skill category. Omit for the Custom-bucket (no `braid.category`) shape. */
  readonly category?: 'ask' | 'build' | 'generate'
}

/**
 * Returns a complete SKILL.md text (frontmatter + body) that passes `SkillStructureValidator`.
 * The body contains all required H2 sections with one-line placeholder content.
 *
 * The validator requires a fixed set of H2 sections per skill category.
 * `FsSkillRegistry` rejects a SKILL.md missing one at load time.
 * Tests that write a real SKILL.md to disk care about that structural contract, not about prose content,
 * so every fixture writer reuses this one minimal-conforming body.
 * When the contract gains a section, whether common or category-specific, update this helper.
 * The existing tests then pick it up automatically.
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
    'Design Principles',
    'Initialization',
    'Procedure',
    'Output',
    'Completion Checklist',
    'Companion Docs',
  ]
  const categorySections = opts.category === 'generate' ? ['Output Files'] : []
  const sections = [...commonSections, ...categorySections]

  const body = sections.map(s => `## ${s}\n\nFixture body for ${s}.`).join('\n\n')

  return `${frontmatter}\n\n${body}\n`
}
