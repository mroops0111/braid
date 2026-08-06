export const transcript = {
  // Empty state shown before any output arrives.
  emptyDescription: 'Output appears here.',
  // Prompt block labels for a skill run.
  promptLabel: 'Prompt',
  followUpLabel: 'Follow-up',
  // Live run indicator.
  runningStatus: 'running…',
  // Collapsible reasoning section.
  thinkingTitle: 'Thinking',
  // Rate-limit notice. `time` is a preformatted clock time.
  rateLimitWaiting: 'waiting on rate limit',
  rateLimitReset: '(resets {time})',
  // Terminal-style event lines. Bracket tags stay verbatim.
  artifactLine: '[artifact] {kind} {id}: {path}',
  completedLine: '[completed] exit={code}',
  errorLine: '[error] {message}',
  // Usage footer turn count.
  turnCount: '{count, plural, one {# turn} other {# turns}}',
  toolCall: {
    arguments: 'Args',
    result: 'Result',
    errorOutput: 'Error output',
    errorBadge: 'error',
    emptyOutput: '(empty)',
  },
  toolGroup: {
    toolCallCount: '{count, plural, one {# tool call} other {# tool calls}}',
    failedCount: '{count} failed',
  },
  mermaid: {
    renderError: 'Mermaid render error',
  },
}

export default transcript
