import type { SkillCategory, SkillFrontmatter, SkillLoadIssue } from '@braidhq/schema'

/**
 * Section heading text required at H2 depth (`## `) in every SKILL.md.
 * Ordering reflects the canonical reading order.
 * Agents read top to bottom, and skipping a section is treated as omission.
 * The validator does not enforce order, only presence.
 * Ordering is style-guide-level.
 */
const REQUIRED_SECTIONS = [
  'Role',
  'Design Principles',
  'Initialization',
  'Procedure',
  'Output',
  'Completion Checklist',
  'Reference Documents',
] as const

/**
 * Sections required on top of the common set, keyed by skill category.
 * A skill with no category declared is held to the common contract only.
 */
const REQUIRED_SECTIONS_BY_CATEGORY: Record<SkillCategory, readonly string[]> = {
  ask: [],
  build: [],
  generate: ['Output Files'],
}

const REFERENCE_DOCUMENTS_SECTION = 'Reference Documents'

/**
 * A reference document is reached through a mounted reference directory,
 * whose absolute path the runner injects as an environment variable.
 * A relative path is the one form that cannot work,
 * since the agent's Read tool resolves neither the session dir nor `$PWD`.
 */
const REFERENCE_PATH_PREFIX = '$BRAID_'

export interface SkillFileInput {
  /** The full SKILL.md body, with frontmatter already stripped. */
  readonly body: string
  /** The parsed frontmatter (already validated against `SkillFrontmatter`). */
  readonly frontmatter: SkillFrontmatter
}

export interface SkillFileValidation {
  readonly ok: boolean
  readonly issues: readonly SkillLoadIssue[]
}

/**
 * One SKILL.md as the checks read it, with the body scanned once.
 *
 * Fenced blocks are dropped here rather than by each check,
 * since a prompt quotes headings and tables inside them,
 * and a check that forgot to skip a fence would read those as real.
 */
interface ReadableSkillFile {
  readonly frontmatter: SkillFrontmatter
  /** Body lines outside fenced code blocks, in document order. */
  readonly lines: readonly string[]
}

type SkillFileCheck = (file: ReadableSkillFile) => SkillLoadIssue[]

/**
 * Each check names one mechanical fault and reads the same input,
 * so adding a fourth is an entry here rather than an edit to the caller.
 */
const CHECKS: readonly SkillFileCheck[] = [
  missingSectionIssues,
  unreachableReferenceDocumentIssues,
  duplicateInputNameIssues,
]

/**
 * Whether a SKILL.md is a usable skill, answered from the file alone.
 *
 * This is the earliest of the three moments a skill is checked at, and the
 * only one whose answer holds in every workspace and on every run, which is
 * why a failure here keeps the file out of the list rather than flagging it.
 *
 * Every check names a way the file breaks once an agent reads it:
 * a section the prompt tells the agent to follow that is not there,
 * a reference document path the Read tool cannot resolve,
 * two inputs the form would bind to one name.
 *
 * House style is deliberately absent. Heading case, dash choice, section
 * order, and prompt length are review matters, and a skill withheld over
 * one of those costs its author more than the rule saves.
 *
 * The checks are text-level, not AST-level.
 */
export function validateSkillFile(input: SkillFileInput): SkillFileValidation {
  const file: ReadableSkillFile = { frontmatter: input.frontmatter, lines: proseLines(input.body) }
  const issues = CHECKS.flatMap(check => check(file))
  return { ok: issues.length === 0, issues }
}

function missingSectionIssues(file: ReadableSkillFile): SkillLoadIssue[] {
  const present = new Set(file.lines.map(headingText).filter(heading => heading !== undefined))
  const category = file.frontmatter.braid.category
  const required = [
    ...REQUIRED_SECTIONS,
    ...(category === undefined ? [] : REQUIRED_SECTIONS_BY_CATEGORY[category]),
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
 * Every row of the Reference Documents table names a file through a mounted
 * path. Only the first cell is read, since that is the column the path lives
 * in, and the prose columns quote field names freely.
 */
function unreachableReferenceDocumentIssues(file: ReadableSkillFile): SkillLoadIssue[] {
  const issues: SkillLoadIssue[] = []
  for (const row of tableRows(linesUnder(file.lines, REFERENCE_DOCUMENTS_SECTION))) {
    const path = (row[0] ?? '').match(/`([^`]+)`/)?.[1]
    if (path === undefined || path.startsWith(REFERENCE_PATH_PREFIX))
      continue
    issues.push({
      kind: 'unreachable-reference-document',
      message: `Reference document "${path}" is not reached through a mounted reference path. Name it from one of the ${REFERENCE_PATH_PREFIX}* directories the runner injects, since a relative path does not resolve inside a run.`,
      target: path,
    })
  }
  return issues
}

function duplicateInputNameIssues(file: ReadableSkillFile): SkillLoadIssue[] {
  // zod enforces each entry's own shape and the kind discriminator,
  // but uniqueness across the list is a cross-cutting rule that lives here.
  const issues: SkillLoadIssue[] = []
  const seen = new Set<string>()
  for (const declaration of file.frontmatter.braid.inputs ?? []) {
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
 * The text of an H2 heading line, or undefined when the line is not one.
 *
 * Trailing whitespace and inline anchors like `## Role {#role}` are trimmed,
 * so authors can decorate headings without breaking validation.
 */
function headingText(line: string): string | undefined {
  if (!line.startsWith('## '))
    return undefined
  const cleaned = line.slice(3).replace(/\s*\{#[^}]+\}\s*$/, '').trim()
  return cleaned.length > 0 ? cleaned : undefined
}

/** The lines under the named H2, up to the next one. Empty when absent. */
function linesUnder(lines: readonly string[], section: string): string[] {
  const body: string[] = []
  let inSection = false
  for (const line of lines) {
    const heading = headingText(line)
    if (heading !== undefined) {
      if (inSection)
        break
      inSection = heading === section
      continue
    }
    if (inSection)
      body.push(line)
  }
  return body
}

/** Cells of the first markdown table in these lines, header and rule dropped. */
function tableRows(lines: readonly string[]): string[][] {
  const rows: string[][] = []
  let started = false
  for (const line of lines) {
    if (!line.trimStart().startsWith('|')) {
      if (started)
        break
      continue
    }
    // The header row opens the table and the alignment rule follows it,
    // and neither carries a path.
    if (!started) {
      started = true
      continue
    }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell)))
      continue
    rows.push(cells)
  }
  return rows
}

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
