export const blocks = {
  // Section heading above a run's rendered output.
  title: 'Answer Blocks',
  findingsHeading: '{count, plural, one {# Finding} other {# Findings}}',
  activity: {
    starting: 'Starting…',
    graphQueries: 'graph queries',
    sourceReads: 'source reads',
    rendered: 'rendered',
  },
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
  subgraph: {
    title: 'Graph Slice',
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
    showDiagram: 'Diagram',
    showSubgraph: 'Subgraph',
    consistency: 'Consistency',
    findingSummary: '{total} checked, {conflicts} in conflict',
  },
  evidence: {
    title: 'Evidence',
    // Marks a reference the run opened itself, which no node cites yet.
    unrecorded: 'unrecorded',
    unrecordedHint: 'This run opened this location itself. No node in the graph cites it yet.',
    openCanonical: 'Open the source where it lives',
    excerptMissing: 'The local mirror no longer holds this location.',
    snippetDrifted: 'The cited text is no longer at these lines. The source has moved since this was recorded.',
    refCount: '{count, plural, one {# source} other {# sources}}',
  },
  finding: {
    support: {
      corroborated: 'corroborated evidence',
      corroboratedHint: 'Every side rests on a location the graph already cites.',
      partial: 'partial evidence',
      partialHint: 'Every side has a source, but at least one is unrecorded in the graph.',
      thin: 'thin evidence',
      thinHint: 'At least one side carries no source at all.',
    },
    recorded: 'recorded',
    unrecorded: 'unrecorded',
    unrecordedHint: 'The graph holds no drift record for this. It surfaced in this run.',
    suggestedSource: 'Would settle it: {source}',
  },
}

export default blocks
