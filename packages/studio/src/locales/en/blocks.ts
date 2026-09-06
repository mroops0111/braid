export const blocks = {
  // Section heading above a run's rendered output.
  title: 'Answer Blocks',
  findingsHeading: '{count, plural, one {# Finding} other {# Findings}}',
  canvas: {
    emptyTitle: 'No Answer Yet',
    emptyDescription: 'Ask a question below and the answer builds here as the run works.',
    workingTitle: 'Working',
    workingDescription: 'Blocks appear here as the run settles each part of the answer.',
  },
  matrix: {
    cellHint: 'Click a cell for its evidence.',
    tone: {
      affirmed: 'allowed',
      denied: 'not allowed',
      conditional: 'depends on settings',
      conflict: 'sources disagree',
      notApplicable: 'not applicable',
    },
  },
  trace: {
    searches: 'searches',
    hits: 'hits',
    read: 'read',
    cited: 'cited',
    skipped: '{count} read but not used',
    searchedHeading: 'Searched',
    citedHeading: 'Cited',
    readHeading: 'Read',
    skippedHeading: 'Read but not used',
    hitCount: '{count, plural, one {# hit} other {# hits}}',
  },
  outline: {
    showAnswer: 'Answer',
    showEvidence: 'Evidence',
    showFinding: 'Finding',
    showMatrix: 'Matrix',
    showTrace: 'Trace',
    consistency: 'Consistency',
    findingSummary: '{total} checked, {conflicts} in conflict',
  },
  evidence: {
    title: 'Evidence',
    // Marks a reference the run opened itself, which no node vouches for yet.
    unverified: 'unverified',
    openCanonical: 'Open the source where it lives',
    excerptMissing: 'The local mirror no longer holds this location.',
    snippetDrifted: 'The cited text is no longer at these lines. The source has moved since this was recorded.',
    refCount: '{count, plural, one {# source} other {# sources}}',
  },
  finding: {
    confidence: '{value}% confidence',
    registered: 'registered',
    unregistered: 'not registered as drift',
    suggestedSource: 'Would settle it: {source}',
  },
}

export default blocks
