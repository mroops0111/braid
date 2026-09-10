import type { CoverageCard, SkillId, SkillRunId, SourceId } from '@braidhq/schema'
import { T0 } from './time.js'

/**
 * One source document, and what the model has made of it.
 *
 * Every field real rather than cast away, so a surface that starts reading a
 * new one stops the tests that fabricate the old shape, which is the whole
 * reason a factory earns its place over a literal.
 */
export function makeCoverageCard(overrides: Partial<CoverageCard> = {}): CoverageCard {
  return {
    sourceId: 'source-a' as SourceId,
    path: 'a-unit/',
    name: 'A Unit',
    state: 'uncovered',
    proposalIds: [],
    clarificationIds: [],
    driftIssueIds: [],
    nodeIds: [],
    ...overrides,
  }
}

/** The run that last touched a document, as a card carries it. */
export function makeCoverageRun(overrides: Partial<CoverageCard['lastRun']> = {}): NonNullable<CoverageCard['lastRun']> {
  return {
    runId: 'run-1' as SkillRunId,
    skillId: 'ddd:extract' as SkillId,
    startedAt: T0,
    ...overrides,
  }
}
