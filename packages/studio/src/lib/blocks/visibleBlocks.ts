import type { AudienceId, EmittedBlock } from '@braidhq/schema'

/**
 * Blocks this reader sees.
 *
 * A block naming nobody is addressed to everyone, which is the common case,
 * because a conclusion belongs to whoever asked.
 * Naming an audience is the exception,
 * for content that says nothing to the others.
 */
export function visibleBlocks(
  blocks: readonly EmittedBlock[],
  view: AudienceId,
): readonly EmittedBlock[] {
  return blocks.filter(entry =>
    entry.block.audiences.length === 0 || entry.block.audiences.includes(view),
  )
}
