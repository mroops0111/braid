export const actionInput = {
  submitDefaultButton: 'Start',
  // Plain Enter stays a newline here, since inputs can be multi-sentence.
  submitShortcutHint: '⌘ + Enter',
  runsSuffix: '{label} ({count, plural, one {# run} other {# runs}})',
  staleBadge: 'stale',
  lastProcessed: 'Last processed {date}',
  changedSinceWithDate: 'Changed since last processed {date}',
  changedSinceLabel: 'Changed since last processed',
  freshness: {
    justNow: 'just now',
    minutesAgo: '{count}m ago',
    hoursAgo: '{count}h ago',
    daysAgo: '{count}d ago',
    recent: 'recent',
  },
}

export default actionInput
