import type { SkillCategory, SkillFrontmatter, SkillLoadIssue } from '@braidhq/schema'

/**
 * Section heading text required at H2 depth (`## `) in every SKILL.md.
 * Ordering reflects the canonical reading order.
 * Agents read top to bottom, and skipping a section is treated as omission.
 * The validator does not enforce order, only presence.
 * Ordering is style-guide-level.
 */
const COMMON_REQUIRED_SECTIONS = [
  'Role',
  'Design Principles',
  'Initialization',
  'Procedure',
  'Output',
  'Completion Checklist',
  'Companion Docs',
] as const

/**
 * Sections required on top of the common set, keyed by skill category.
 * A skill with no category declared is held to the common contract only.
 */
const CATEGORY_SPECIFIC_REQUIRED_SECTIONS: Record<SkillCategory, readonly string[]> = {
  ask: [],
  build: [],
  generate: ['Output Files'],
}

/**
 * A companion doc is reached through a mounted reference directory,
 * whose absolute path the runner injects as an environment variable.
 * A relative path is the one form that cannot work,
 * since the agent's Read tool resolves neither the session dir nor `$PWD`.
 */
const REFERENCE_PATH_PREFIX = '$BRAID_'

export interface ValidateSkillStructureInput {
  /** The full SKILL.md body, with frontmatter already stripped. */
  readonly body: string
  /** The parsed frontmatter (already validated against `SkillFrontmatter`). */
  readonly frontmatter: SkillFrontmatter
}

export interface SkillStructureValidationResult {
  readonly ok: boolean
  readonly issues: readonly SkillLoadIssue[]
}

/**
 * Pure parser and checker over one SKILL.md body.
 *
 * Every check names a way the file breaks at run time:
 * a section the prompt tells the agent to follow that is not there,
 * a companion doc path the Read tool cannot resolve,
 * two inputs the form would bind to one name.
 *
 * House style is deliberately absent. Heading case, dash choice, section
 * order, and prompt length are review matters, and a skill withheld over
 * one of those costs its author more than the rule saves.
 *
 * The validator is intentionally text-level, not AST-level.
 * Fenced blocks are tracked, since a prompt quotes headings inside them,
 * and everything else is read as prose.
 */
export function validateSkillStructure(input: ValidateSkillStructureInput): SkillStructureValidationResult {
  const issues: SkillLoadIssue[] = [
    ...missingSectionIssues(input),
    ...companionDocIssues(input.body),
    ...duplicateInputIssues(input.frontmatter),
  ]
  return { ok: issues.length === 0, issues }
}

function missingSectionIssues(input: ValidateSkillStructureInput): SkillLoadIssue[] {
  const present = collectH2Headings(input.body)
  const category = input.frontmatter.braid.category
  const required = [
    ...COMMON_REQUIRED_SECTIONS,
    ...(category === undefined ? [] : CATEGORY_SPECIFIC_REQUIRED_SECTIONS[category]),
  ]
  return required
    .filter(section => !present.has(section))
    .map(section => ({
      kind: 'missing-section' as const,
      message: `SKILL.md is missing required H2 section "## ${section}".`,
      target: section,
    }))
}

/**
 * Every row of the Companion Docs table names a file through a mounted path.
 * Only the first cell is read, since that is the column the path lives in,
 * and the prose columns quote field names freely.
 */
function companionDocIssues(body: string): SkillLoadIssue[] {
  const issues: SkillLoadIssue[] = []
  for (const row of tableRowsUnder(body, 'Companion Docs')) {
    const path = (row[0] ?? '').match(/`([^`]+)`/)?.[1]
    if (path === undefined || path.startsWith(REFERENCE_PATH_PREFIX))
      continue
    issues.push({
      kind: 'companion-doc-path',
      message: `Companion doc "${path}" is not reached through a mounted reference path. Name it from one of the ${REFERENCE_PATH_PREFIX}* directories the runner injects, since a relative path does not resolve inside a run.`,
      target: path,
    })
  }
  return issues
}

function duplicateInputIssues(frontmatter: SkillFrontmatter): SkillLoadIssue[] {
  // zod enforces each entry's own shape and the kind discriminator,
  // but uniqueness across the list is a cross-cutting rule that lives here.
  const issues: SkillLoadIssue[] = []
  const seen = new Set<string>()
  for (const declaration of frontmatter.braid.inputs ?? []) {
    if (seen.has(declaration.name)) {
      issues.push({
        kind: 'duplicate-input-name',
        message: `SKILL.md declares input name "${declaration.name}" more than once. Each input must have a unique name.`,
        target: declaration.name,
      })
    }
    seen.add(declaration.name)
  }
  return issues
}

/**
 * Extract the text of every line that opens with `## `, case-sensitive,
 * and isn't inside a fenced code block.
 * Returns a `Set` for O(1) membership checks downstream.
 *
 * Trailing whitespace and inline anchors like `## Role {#role}` are trimmed,
 * so authors can decorate headings without breaking validation.
 */
function collectH2Headings(body: string): Set<string> {
  const headings = new Set<string>()
  for (const line of proseLines(body)) {
    const heading = headingText(line)
    if (heading !== undefined)
      headings.add(heading)
  }
  return headings
}

/** The text of an H2 heading line, or undefined when the line is not one. */
function headingText(line: string): string | undefined {
  if (!line.startsWith('## ') || line.startsWith('### '))
    return undefined
  // Strip a trailing inline anchor like ` {#anchor}` if present.
  const cleaned = line.slice(3).replace(/\s*\{#[^}]+\}\s*$/, '').trim()
  return cleaned.length > 0 ? cleaned : undefined
}

/** The rows of the first markdown table under the named H2, header and rule dropped. */
function tableRowsUnder(body: string, section: string): string[][] {
  const rows: string[][] = []
  let inSection = false
  let inTable = false
  for (const line of proseLines(body)) {
    const heading = headingText(line)
    if (heading !== undefined) {
      if (inSection)
        break
      inSection = heading === section
      continue
    }
    if (!inSection)
      continue
    if (!line.trimStart().startsWith('|')) {
      if (inTable)
        break
      continue
    }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
    // The header row and the alignment rule under it carry no path.
    if (!inTable) {
      inTable = true
      continue
    }
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell)))
      continue
    rows.push(cells)
  }
  return rows
}

/** Body lines outside fenced code blocks, where a heading or a table counts. */
function proseLines(body: string): string[] {
  const lines: string[] = []
  let inFence = false
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd()
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (!inFence)
      lines.push(line)
  }
  return lines
}
