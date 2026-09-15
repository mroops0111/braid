export const ask = {
  // Left panel listing past answers, titled by the question that produced them.
  loading: 'Loading…',
  answersHeading: 'Answers',
  newQuestion: 'New',
  noAnswers: 'No answers yet. Ask a question below.',
  showAnswers: 'Show Answers',
  hideAnswers: 'Hide Answers',
  placeholderHeading: 'Ask a question about this workspace.',
  inputPlaceholder: 'Ask anything, or use @ to point at a node…',
  send: 'Ask',
  asking: 'Asking…',
  // Letting another member of the workspace read one conversation.
  answerActions: 'More Actions',
  rename: 'Rename',
  deleting: 'Deleting…',
  deleteDialogTitle: 'Delete this conversation?',
  deleteDialogDescription: '{count, plural, one {One turn and its transcript are removed for good.} other {# turns and their transcripts are removed for good. Anyone it was shared with loses access.}}',
  share: 'Share',
  sharedBy: 'Shared by {name}',
  sharedWith: 'Shared with {name}',
  sharedWithCount: 'Shared with {count} people',
  shareDialogTitle: 'Share Conversation',
  shareDialogDescription: 'They read the full transcript, tool calls and thinking included. They cannot reply, rename, or delete.',
  shareFilterPlaceholder: 'Find a member…',
  shareNoMembers: 'No one else is in this workspace.',
  shareNoMatches: 'No member by that name.',
  shareGrant: 'Share',
  shareHolds: 'Shared',
  shareFailed: 'Could not change the share. Try again.',
  shareDone: 'Done',
  sharedReadOnlyNotice: 'Shared with you to read. Start your own conversation to carry the work on.',
  sharedPlaceholder: 'Shared with you to read.',
  // Shown when the workspace has no skill in the ask category.
  noSkillTitle: 'No Ask Skill',
  noSkillDescription: 'This workspace has no skill in the ask category, so there is nothing to ask.',
  // Only the transcript is named here.
  // Audience labels come from the ontology that declared them,
  // so a downstream product names its own.
  view: {
    transcript: 'Transcript',
  },
}

export default ask
