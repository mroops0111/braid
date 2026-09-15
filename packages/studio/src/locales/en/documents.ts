export const documents = {
  write: 'Write Document',
  filterPlaceholder: 'Filter documents…',
  regenerate: 'Regenerate',
  writing: 'Writing…',
  stale: 'Out of date',
  staleNotice: 'The graph has changed since this was written. Regenerate to catch it up.',
  empty: {
    title: 'No Documents Yet',
    description: 'A document is written out of one node and everything the ontology nests under it. Pick a subject and a form to write the first one.',
  },
  noMatches: {
    title: 'Nothing Matches',
    description: 'No document is about a subject with that in its name. Clear the filter to see them all.',
  },
  noSelection: {
    title: 'Nothing Open',
    description: 'Pick a document on the left to read it.',
  },
  noSubjects: {
    title: 'Nothing To Write About',
    description: 'A document is written out of a container node, and this graph holds none yet. Build the graph first.',
  },
  dialog: {
    title: 'Write Document',
    description: 'Pick what the document is about, then how it should be written.',
    subjectLabel: 'Subject',
    subjectPlaceholder: 'Search containers…',
    formLabel: 'Form',
    noSubjects: 'No node this form can be written about.',
    submit: 'Write',
    cancel: 'Cancel',
  },
}

export default documents
