import type { Reference } from '@braidhq/schema'
import type { Element, ElementContent, Root, RootContent, Text } from 'hast'
import { parseReference, Reference as ReferenceSchema, splitReferences } from '@braidhq/schema'

export const REFERENCE_KIND_ATTRIBUTE = 'data-reference-kind'
export const REFERENCE_ID_ATTRIBUTE = 'data-reference-id'

// Fenced code is sample text a reader is meant to copy, so it stays literal.
// Inline code is different. Skills habitually wrap identifiers in backticks,
// so a lone token inside one is still a reference and becomes the tag itself,
// rather than a tag nested in code styling.
const LITERAL_TAGS = new Set(['pre'])
const INLINE_CODE_TAG = 'code'

/**
 * Rewrites `@kind:id` tokens in rendered markdown into carrier spans,
 * which `Markdown` maps to a tag through its `span` component.
 * Running on the parsed tree, rather than the raw string,
 * covers tokens inside lists, tables, and emphasis with no extra cases.
 */
export function rehypeReferences() {
  return (tree: Root): void => {
    tree.children = tree.children.flatMap(child => expandNode(child))
  }
}

/** Reads a carrier span's attributes back into a reference. */
export function readReferenceProps(props: Record<string, unknown>): Reference | null {
  const kind = props[REFERENCE_KIND_ATTRIBUTE]
  const id = props[REFERENCE_ID_ATTRIBUTE]
  if (typeof kind !== 'string' || typeof id !== 'string')
    return null
  const parsed = ReferenceSchema.safeParse({ kind, id })
  return parsed.success ? parsed.data : null
}

function expandNode<T extends RootContent>(node: T): Array<T | ElementContent> {
  if (node.type === 'element') {
    if (LITERAL_TAGS.has(node.tagName))
      return [node]
    if (node.tagName === INLINE_CODE_TAG) {
      const only = parseReference(textOf(node))
      return only ? [referenceElement(only)] : [node]
    }
    node.children = node.children.flatMap(child => expandNode(child))
    return [node]
  }
  if (node.type === 'text')
    return splitTextNode(node)
  return [node]
}

/** Concatenated text of an element, ignoring any nested markup. */
function textOf(node: Element): string {
  return node.children
    .map(child => (child.type === 'text' ? child.value : ''))
    .join('')
}

function splitTextNode(node: Text): ElementContent[] {
  const segments = splitReferences(node.value)
  if (segments.every(segment => segment.type === 'text'))
    return [node]
  return segments.map(segment => (
    segment.type === 'text'
      ? { type: 'text', value: segment.text }
      : referenceElement(segment.reference)
  ))
}

function referenceElement(reference: Reference): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      [REFERENCE_KIND_ATTRIBUTE]: reference.kind,
      [REFERENCE_ID_ATTRIBUTE]: reference.id,
    },
    children: [],
  }
}
