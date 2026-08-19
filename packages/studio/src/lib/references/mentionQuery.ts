import type { Reference } from '@braidhq/schema'
import { formatReference } from '@braidhq/schema'

export interface ActiveMention {
  /** Offset of the `@` that opened the mention. */
  readonly start: number
  /** Text typed after the `@`, empty right after the trigger. */
  readonly query: string
}

export interface MentionInsertion {
  readonly value: string
  readonly caret: number
}

// A mention is one word, so scanning further back only finds prose.
const MAX_QUERY_LENGTH = 64

/**
 * Reads the mention the caret currently sits in, if any.
 * Returns null once the query grows a space or a colon, since a space ends,
 * the word and a colon means the caret re-entered a finished token.
 */
export function findActiveMention(value: string, caret: number): ActiveMention | null {
  const lowest = Math.max(0, caret - MAX_QUERY_LENGTH)
  for (let index = caret - 1; index >= lowest; index--) {
    const character = value[index] ?? ''
    if (/\s/.test(character))
      return null
    if (character !== '@')
      continue
    const previous = index === 0 ? '' : value[index - 1] ?? ''
    if (previous !== '' && /[\w@]/.test(previous))
      return null
    const query = value.slice(index + 1, caret)
    return query.includes(':') ? null : { start: index, query }
  }
  return null
}

/**
 * True when two reads describe the same live mention.
 * Callers use it to leave menu state alone on events that changed nothing,
 * such as the key-up after an arrow key that only moved the highlight.
 */
export function sameMention(left: ActiveMention | null, right: ActiveMention | null): boolean {
  if (left === null || right === null)
    return left === right
  return left.start === right.start && left.query === right.query
}

/** Replaces the mention under the caret with a finished token plus a trailing space. */
export function applyMention(
  value: string,
  mention: ActiveMention,
  caret: number,
  reference: Reference,
): MentionInsertion {
  const token = `${formatReference(reference)} `
  return {
    value: value.slice(0, mention.start) + token + value.slice(caret),
    caret: mention.start + token.length,
  }
}
