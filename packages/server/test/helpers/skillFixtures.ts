/**
 * SKILL.md fixtures for tests that materialise a real file on disk.
 *
 * The repo's `validateSkillFile` requires a fixed set of H2 sections per skill category,
 * and a SKILL.md missing one is rejected by `FsSkillRegistry` at load time.
 * Tests don't care about prose content,
 * they care that the structural contract is satisfied,
 * so we keep a single minimal-conforming body here,
 * and every test fixture writer can reuse it.
 *
 * When the structure contract evolves,
 * a new required section or a new category-specific one,
 * update this helper and the existing tests pick it up automatically.
 */

export interface MakeSkillFileOptions {
  readonly name: string
  readonly description?: string
  /** Skill category. Omit for the Custom-bucket (no `braid.category`) shape. */
  readonly category?: 'ask' | 'build' | 'generate'
  /** Section names to leave out of the body, for a test that wants a file missing one. */
  readonly omitSections?: readonly string[]
}

/**
 * Returns a complete SKILL.md text (frontmatter + body) that passes `validateSkillFile`.
 * The body contains all required H2 sections with one-line placeholder content.
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
    'Reference Documents',
  ]
  const categorySections = opts.category === 'generate' ? ['Output Files'] : []
  const omitted = new Set(opts.omitSections ?? [])
  const sections = [...commonSections, ...categorySections].filter(section => !omitted.has(section))

  const body = sections.map(s => `## ${s}\n\nFixture body for ${s}.`).join('\n\n')

  return `${frontmatter}\n\n${body}\n`
}
