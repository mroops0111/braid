export const references = {
  // Tag whose target the registry could not resolve.
  // Lowercase, since the interpolated kind is a lowercase identifier.
  unknownTooltip: 'unknown {kind} reference',
  // Destination labels for the action that leaves the current surface.
  openInGraph: 'Open in Graph',
  openFallback: 'Open',
  peek: {
    missingTitle: 'Reference Not Found',
    missingDescription: 'Nothing in this workspace answers to "{id}". It may have been renamed or removed.',
  },
  // Shown under a menu that stopped listing,
  // so a reader narrows the query rather than assuming they saw everything.
  menuMore: '{count, plural, one {# more match} other {# more matches}}',
  mention: {
    triggerHint: 'Type @ to reference a node',
    emptyDescription: 'No matching nodes.',
  },
  picker: {
    searchPlaceholder: 'Search nodes…',
    emptyDescription: 'No matching nodes.',
    clearButton: 'Clear',
  },
}

export default references
