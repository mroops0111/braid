import type { SkillRunId } from '@braidhq/schema'

/**
 * What a continued run has to be told about itself.
 *
 * A run's id reaches the agent as an environment variable,
 * read once near the top of a conversation.
 * A continuation resumes that same conversation in a new process,
 * so the agent still holds the id of the run that has since closed,
 * and every render call it makes lands on a run nobody is listening to.
 * The correction cannot come from the environment,
 * since the conversation has already read it,
 * so it comes in the only channel the conversation is still reading.
 */
export function restateRunId(runId: SkillRunId): string {
  return [
    `This is a new run, and its id is ${runId}.`,
    'It replaces whatever run id you were given earlier in this conversation, which belongs to a run that has closed.',
    'Use this one for every braid-core call from here, and read $BRAID_RUN_ID again rather than trusting what you remember.',
  ].join(' ')
}
