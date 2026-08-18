import type { Element, Root, RootContent } from 'hast'
import { describe, expect, it } from 'vitest'
import {
  readReferenceProps,
  REFERENCE_ID_ATTRIBUTE,
  REFERENCE_KIND_ATTRIBUTE,
  rehypeReferences,
} from '../../../src/components/references/rehypeReferences'

function text(value: string): RootContent {
  return { type: 'text', value }
}

function element(tagName: string, children: RootContent[]): Element {
  return { type: 'element', tagName, properties: {}, children: children as Element['children'] }
}

function run(children: RootContent[]): RootContent[] {
  const tree: Root = { type: 'root', children }
  rehypeReferences()(tree)
  return tree.children
}

function describeNode(node: RootContent): string {
  if (node.type === 'text')
    return `text:${node.value}`
  if (node.type === 'element' && node.properties?.[REFERENCE_ID_ATTRIBUTE])
    return `ref:${String(node.properties[REFERENCE_ID_ATTRIBUTE])}`
  return node.type === 'element' ? `element:${node.tagName}` : node.type
}

describe('rehypeReferences', () => {
  it('splits a token out of surrounding prose', () => {
    expect(run([text('rewired @node:ctx.signTask today')]).map(describeNode)).toEqual([
      'text:rewired ',
      'ref:ctx.signTask',
      'text: today',
    ])
  })

  it('replaces an inline code span holding one token', () => {
    // Skills habitually wrap identifiers in backticks, so this is the shape
    // real transcripts arrive in.
    const out = run([element('p', [element('code', [text('@node:agg.cart')])])])
    const paragraph = out[0] as Element
    expect(paragraph.children.map(child => describeNode(child as RootContent))).toEqual(['ref:agg.cart'])
  })

  it('leaves inline code that is not exactly one token', () => {
    const out = run([element('p', [element('code', [text('see @node:agg.cart here')])])])
    const paragraph = out[0] as Element
    expect(paragraph.children.map(child => describeNode(child as RootContent))).toEqual(['element:code'])
  })

  it('leaves fenced code alone so samples stay copyable', () => {
    const out = run([element('pre', [element('code', [text('@node:agg.cart')])])])
    const pre = out[0] as Element
    const code = pre.children[0] as Element
    expect(code.tagName).toBe('code')
    expect((code.children[0] as { value: string }).value).toBe('@node:agg.cart')
  })

  it('descends into nested markup such as table cells', () => {
    const out = run([element('td', [text('owns @node:ctx.signTask')])])
    const cell = out[0] as Element
    expect(cell.children.map(child => describeNode(child as RootContent))).toEqual([
      'text:owns ',
      'ref:ctx.signTask',
    ])
  })

  it('leaves prose with no token untouched', () => {
    expect(run([text('plain prose')]).map(describeNode)).toEqual(['text:plain prose'])
  })
})

describe('readReferenceProps', () => {
  it('reads a carrier span back into a reference', () => {
    expect(readReferenceProps({
      [REFERENCE_KIND_ATTRIBUTE]: 'node',
      [REFERENCE_ID_ATTRIBUTE]: 'agg.cart',
    })).toEqual({ kind: 'node', id: 'agg.cart' })
  })

  it('returns null for an ordinary span', () => {
    expect(readReferenceProps({ className: 'whatever' })).toBeNull()
  })

  it('returns null for a malformed kind', () => {
    expect(readReferenceProps({
      [REFERENCE_KIND_ATTRIBUTE]: 'Node',
      [REFERENCE_ID_ATTRIBUTE]: 'agg.cart',
    })).toBeNull()
  })
})
