import type { SkillCategory, SkillFrontmatter } from '@braidhq/schema'

/**
 * Section heading text required at H2 depth (`## `) in every SKILL.md.
 * Ordering reflects the canonical reading order — agents read top to
 * bottom and skipping a section is treated as omission. The validator
 * does not enforce order, only presence; ordering is style-guide-level.
 */
const COMMON_REQUIRED_SECTIONS = [
  'Role',
  'Inputs & Outputs',
  'Design Principles',
  'Initialization',
  'Procedure',
  'Output',
  'Failure Handling',
  'Completion Checklist',
  'Companion docs',
] as const

/**
 * Sections that are required only for specific skill categories.
 * Unknown categories (those not in `SkillCategory`) require no
 * category-specific section and are flagged separately.
 */
const CATEGORY_SPECIFIC_REQUIRED_SECTIONS: Record<SkillCategory, readonly string[]> = {
  ask: [],
  build: [],
  generate: ['Output Files'],
}

export interface SkillStructureIssue {
  readonly kind: 'missing-section' | 'unknown-category' | 'invalid-h2'
  readonly message: string
  /** When kind is `missing-section`, the section heading that was expected. */
  readonly section?: string
}

export interface ValidateSkillStructureInput {
  /** The full SKILL.md body, with frontmatter already stripped. */
  readonly body: string
  /** The parsed frontmatter (already validated against `SkillFrontmatter`). */
  readonly frontmatter: SkillFrontmatter
}

export interface SkillStructureValidationResult {
  readonly ok: boolean
  readonly issues: readonly SkillStructureIssue[]
}

/**
 * Pure parser + checker. Extracts every H2 heading from the SKILL.md
 * body and asserts that the required-section contract for the skill's
 * category is satisfied.
 *
 * Skills without a `braid.category` (workspace one-offs in the
 * "Custom" sidebar bucket) are held to the common contract only —
 * they have to declare the structural sections, but no category-
 * specific section is required of them.
 *
 * The validator is intentionally text-level, not AST-level: a SKILL.md
 * with an H2 inside a fenced code block is unusual enough that we
 * don't pay the parser cost for it. If it bites, switch to a markdown
 * AST library here; the contract surface to callers stays the same.
 */
export function validateSkillStructure(input: ValidateSkillStructureInput): SkillStructureValidationResult {
  const issues: SkillStructureIssue[] = []
  const present = collectH2Headings(input.body)

  const requiredCommon = COMMON_REQUIRED_SECTIONS
  for (const section of requiredCommon) {
    if (!present.has(section)) {
      issues.push({
        kind: 'missing-section',
        message: `SKILL.md is missing required H2 section "## ${section}".`,
        section,
      })
    }
  }

  const category = input.frontmatter.braid.category
  if (category !== undefined) {
    const required = CATEGORY_SPECIFIC_REQUIRED_SECTIONS[category]
    for (const section of required) {
      if (!present.has(section)) {
        issues.push({
          kind: 'missing-section',
          message: `SKILL.md (category "${category}") is missing required H2 section "## ${section}".`,
          section,
        })
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

/**
 * Extract the text of every line that opens with `## ` (case-sensitive)
 * and isn't inside a fenced code block. Returns a `Set` for O(1)
 * membership checks downstream.
 *
 * Trailing whitespace and inline anchors like `## Role {#role}` are
 * trimmed so authors can decorate headings without breaking validation.
 */
function collectH2Headings(body: string): Set<string> {
  const headings = new Set<string>()
  let inFence = false
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence)
      continue
    if (!line.startsWith('## ') || line.startsWith('### '))
      continue
    // Strip a trailing inline anchor like ` {#anchor}` if present.
    const cleaned = line.slice(3).replace(/\s*\{#[^}]+\}\s*$/, '').trim()
    if (cleaned.length > 0)
      headings.add(cleaned)
  }
  return headings
}
