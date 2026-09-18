export const inbox = {
  filter: {
    all: 'All {count}',
    asked: 'Questions {count}',
    proposed: 'Changes {count}',
  },
  emptyTitle: 'Nothing Waiting',
  emptyDescription: 'Questions a run could not settle on its own, and changes waiting for review, arrive here.',
  kind: { running: 'Running', questions: 'Questions', question: 'Question', change: 'Change' },
  view: { question: 'Question', change: 'Change', live: 'Live', reasoning: 'Basis' },
  reasoning: 'Basis for This',
  reasoningLoading: 'Loading the run record…',
  questionIndex: 'Q{index}',
  answeredWaiting: '{count} answered, waiting for the step that reads them.',
  transcript: 'Run record ({count} events)',
  untitled: 'no description',
  showingAll: 'Showing All',
  mineOnly: 'Mine Only',
  showingAllTooltip: 'Showing what every member is waiting on',
  mineOnlyTooltip: 'Showing only yours, and what the system raised',
  bySystem: 'System',
}

export default inbox
