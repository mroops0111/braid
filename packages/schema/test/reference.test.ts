import type {
  Reference,
} from '../src/index.js'
import { describe, expect, it } from 'vitest'
import {
  formatReference,
  NODE_REFERENCE_KIND,
  parseReference,
  ReferenceKind,
  scanReferences,
  splitReferences,
} from '../src/index.js'

function nodeReference(id: string): Reference {
  return { kind: NODE_REFERENCE_KIND, id }
}

describe('referenceKind', () => {
  it('accepts lower kebab-case kinds', () => {
    expect(ReferenceKind.parse('node')).toBe('node')
    expect(ReferenceKind.parse('source-unit')).toBe('source-unit')
  })
  it('rejects upper case and leading digits', () => {
    expect(ReferenceKind.safeParse('Node').success).toBe(false)
    expect(ReferenceKind.safeParse('1node').success).toBe(false)
  })
})

describe('formatReference', () => {
  it('writes the bare form for ASCII ids', () => {
    expect(formatReference(nodeReference('ctx.signTask'))).toBe('@node:ctx.signTask')
    expect(formatReference(nodeReference('intents/checkout'))).toBe('@node:intents/checkout')
  })
  it('brackets ids a bare token cannot carry', () => {
    expect(formatReference(nodeReference('簽署任務'))).toBe('@node:[簽署任務]')
    expect(formatReference(nodeReference('checkout flow'))).toBe('@node:[checkout flow]')
  })
  it('brackets ids ending in a separator so the token round-trips', () => {
    const reference = nodeReference('ctx.signTask.')
    expect(formatReference(reference)).toBe('@node:[ctx.signTask.]')
    expect(parseReference(formatReference(reference))).toEqual(reference)
  })
})

describe('parseReference', () => {
  it('parses a whole token', () => {
    expect(parseReference('@node:ctx.signTask')).toEqual(nodeReference('ctx.signTask'))
    expect(parseReference('@node:[簽署任務]')).toEqual(nodeReference('簽署任務'))
  })
  it('rejects text that is more than one token', () => {
    expect(parseReference('see @node:ctx.signTask')).toBeNull()
    expect(parseReference('@node:a @node:b')).toBeNull()
    expect(parseReference('ctx.signTask')).toBeNull()
  })
})

describe('scanReferences', () => {
  it('finds tokens inside prose', () => {
    const matches = scanReferences('rewired @node:ctx.signTask and @node:agg.cart today')
    expect(matches.map(match => match.reference.id)).toEqual(['ctx.signTask', 'agg.cart'])
    expect(matches[0]?.start).toBe(8)
    expect(matches[0]?.end).toBe(26)
  })
  it('stops a bare id before sentence punctuation', () => {
    expect(scanReferences('touches @node:ctx.signTask.')[0]?.reference.id).toBe('ctx.signTask')
    expect(scanReferences('觸及 @node:ctx.signTask。')[0]?.reference.id).toBe('ctx.signTask')
    expect(scanReferences('(@node:agg.cart), then')[0]?.reference.id).toBe('agg.cart')
  })
  it('reports the token end without the trimmed punctuation', () => {
    const text = 'touches @node:ctx.signTask.'
    const match = scanReferences(text)[0]
    expect(text.slice(match?.start, match?.end)).toBe('@node:ctx.signTask')
  })
  it('ignores a token glued to the preceding word', () => {
    expect(scanReferences('someone@node:ctx.signTask')).toEqual([])
    expect(scanReferences('@@node:ctx.signTask')).toEqual([])
  })
  it('ignores a token with no id left after trimming', () => {
    expect(scanReferences('@node:...')).toEqual([])
  })
  it('keeps an unknown kind so a later resolver can claim it', () => {
    expect(scanReferences('@source-unit:[intents/checkout.md]')[0]?.reference).toEqual({
      kind: ReferenceKind.parse('source-unit'),
      id: 'intents/checkout.md',
    })
  })
  it('does not carry match state between calls', () => {
    const text = '@node:agg.cart'
    expect(scanReferences(text)).toHaveLength(1)
    expect(scanReferences(text)).toHaveLength(1)
  })
})

describe('splitReferences', () => {
  it('interleaves text and reference runs', () => {
    expect(splitReferences('see @node:agg.cart now')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'reference', reference: nodeReference('agg.cart'), text: '@node:agg.cart' },
      { type: 'text', text: ' now' },
    ])
  })
  it('returns a single text run when nothing matches', () => {
    expect(splitReferences('plain prose')).toEqual([{ type: 'text', text: 'plain prose' }])
  })
  it('returns nothing for empty text', () => {
    expect(splitReferences('')).toEqual([])
  })
  it('rejoins to the original text', () => {
    const text = 'a @node:agg.cart b @node:[簽署任務]. c'
    expect(splitReferences(text).map(segment => segment.text).join('')).toBe(text)
  })
})
