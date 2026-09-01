import type { GraphNode } from '@braidhq/schema'
import { createHash } from 'node:crypto'

/**
 * The text a node is searched by.
 *
 * Name and description both,
 * since a node's vocabulary is mostly in its description,
 * and a name alone is what left substring search half blind.
 * Ids and types are left out, they are structure rather than language,
 * and the type filter already selects on them exactly.
 */
export function embeddingTextFor(node: GraphNode): string {
  return node.description ? `${node.name}\n\n${node.description}` : node.name
}

/**
 * Identifies the text a stored vector was built from.
 * A rebuild compares this before spending a model call,
 * which on a graph where one node changed skips every other node.
 */
export function hashEmbeddingText(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}
