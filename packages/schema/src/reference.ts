import { z } from 'zod'

/** Branded, not an enum, so a package registers a new kind without editing schema. */
export const ReferenceKind = z.string().regex(/^[a-z][a-z0-9-]*$/, 'ReferenceKind must be lower kebab-case').brand<'ReferenceKind'>()
export type ReferenceKind = z.infer<typeof ReferenceKind>

/** The graph node kind, the only one schema itself owns. */
export const NODE_REFERENCE_KIND: ReferenceKind = ReferenceKind.parse('node')

/**
 * An inline pointer from prose to something a reader can open.
 * Both humans and skills write it, so the token grammar below,
 * is the shared contract between Studio and the skill prompt layer.
 */
export const Reference = z.object({
  kind: ReferenceKind,
  id: z.string().min(1),
})
export type Reference = z.infer<typeof Reference>

export interface ReferenceMatch {
  readonly reference: Reference
  readonly start: number
  /** Offset just past the last character of the token. */
  readonly end: number
}

export type ReferenceSegment =
  | { readonly type: 'text', readonly text: string }
  | { readonly type: 'reference', readonly reference: Reference, readonly text: string }

/**
 * `@kind:id`, with `@kind:[id]` for ids carrying whitespace or non-ASCII.
 * The bare form stops at the first character an id cannot hold,
 * so sentence punctuation and CJK prose terminate the token by themselves.
 */
const REFERENCE_PATTERN = /@([a-z][a-z0-9-]*):(?:\[([^\]\n]+)\]|([\w.\-/]+))/g

const BARE_ID_PATTERN = /^[\w.\-/]+$/

/** An id never ends in a separator, so a trailing one belongs to the sentence. */
const TRAILING_SEPARATORS = /[.\-/]+$/

export function formatReference(reference: Reference): string {
  const bare = BARE_ID_PATTERN.test(reference.id) && !TRAILING_SEPARATORS.test(reference.id)
  return bare ? `@${reference.kind}:${reference.id}` : `@${reference.kind}:[${reference.id}]`
}

/** Parses one whole token. Returns null when the text is anything more. */
export function parseReference(token: string): Reference | null {
  const matches = scanReferences(token)
  const only = matches[0]
  if (!only || matches.length !== 1 || only.start !== 0 || only.end !== token.length)
    return null
  return only.reference
}

export function scanReferences(text: string): readonly ReferenceMatch[] {
  const matches: ReferenceMatch[] = []
  for (const found of text.matchAll(REFERENCE_PATTERN)) {
    const start = found.index
    // A token glued to the preceding word is part of that word,
    // which keeps addresses such as `someone@node:x` out of the graph.
    if (start > 0 && /[\w@]/.test(text[start - 1] ?? ''))
      continue
    const kind = ReferenceKind.parse(found[1])
    const bracketed = found[2]
    if (bracketed !== undefined) {
      matches.push({ reference: { kind, id: bracketed }, start, end: start + found[0].length })
      continue
    }
    const id = (found[3] ?? '').replace(TRAILING_SEPARATORS, '')
    if (id.length === 0)
      continue
    matches.push({ reference: { kind, id }, start, end: start + kind.length + id.length + 2 })
  }
  return matches
}

/** Splits prose into renderable runs. Text between tokens is preserved verbatim. */
export function splitReferences(text: string): readonly ReferenceSegment[] {
  const segments: ReferenceSegment[] = []
  let cursor = 0
  for (const match of scanReferences(text)) {
    if (match.start > cursor)
      segments.push({ type: 'text', text: text.slice(cursor, match.start) })
    segments.push({ type: 'reference', reference: match.reference, text: text.slice(match.start, match.end) })
    cursor = match.end
  }
  if (cursor < text.length)
    segments.push({ type: 'text', text: text.slice(cursor) })
  return segments
}
