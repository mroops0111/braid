import { NODE_REFERENCE_KIND } from '@braidhq/schema'
import { describe, expect, it } from 'vitest'
import { applyMention, findActiveMention, sameMention } from '../../../src/lib/references/mentionQuery'

const CART = { kind: NODE_REFERENCE_KIND, id: 'agg.cart' }

describe('findActiveMention', () => {
  it('opens right after the trigger', () => {
    expect(findActiveMention('ask @', 5)).toEqual({ start: 4, query: '' })
  })

  it('carries the typed query', () => {
    expect(findActiveMention('ask @sign', 9)).toEqual({ start: 4, query: 'sign' })
  })

  it('opens at the start of the field', () => {
    expect(findActiveMention('@cart', 5)).toEqual({ start: 0, query: 'cart' })
  })

  it('closes once the query grows a space', () => {
    expect(findActiveMention('ask @sign task', 14)).toBeNull()
  })

  it('ignores a trigger glued to the preceding word', () => {
    expect(findActiveMention('someone@sign', 12)).toBeNull()
  })

  it('stays closed inside a finished token', () => {
    expect(findActiveMention('@node:agg.cart', 10)).toBeNull()
  })

  it('returns null when the caret sits before any trigger', () => {
    expect(findActiveMention('plain prose', 5)).toBeNull()
  })

  it('gives up rather than scanning a whole paragraph back', () => {
    expect(findActiveMention(`@${'x'.repeat(100)}`, 101)).toBeNull()
  })
})

describe('sameMention', () => {
  it('treats two null reads as the same', () => {
    expect(sameMention(null, null)).toBe(true)
  })
  it('treats an opening or closing mention as a change', () => {
    expect(sameMention(null, { start: 0, query: '' })).toBe(false)
    expect(sameMention({ start: 0, query: '' }, null)).toBe(false)
  })
  it('ignores a repeat read of the same mention', () => {
    expect(sameMention({ start: 4, query: 'sign' }, { start: 4, query: 'sign' })).toBe(true)
  })
  it('reports a changed query or a new trigger', () => {
    expect(sameMention({ start: 4, query: 'sign' }, { start: 4, query: 'signT' })).toBe(false)
    expect(sameMention({ start: 4, query: 'sign' }, { start: 9, query: 'sign' })).toBe(false)
  })
})

describe('applyMention', () => {
  it('replaces the mention with a token and a trailing space', () => {
    const mention = findActiveMention('ask @ca', 7)!
    expect(applyMention('ask @ca', mention, 7, CART)).toEqual({
      value: 'ask @node:agg.cart ',
      caret: 19,
    })
  })

  it('keeps the text that followed the caret', () => {
    const mention = findActiveMention('ask @ca then', 7)!
    expect(applyMention('ask @ca then', mention, 7, CART).value).toBe('ask @node:agg.cart  then')
  })

  it('brackets an id a bare token cannot carry', () => {
    const mention = findActiveMention('@qi', 3)!
    const inserted = applyMention('@qi', mention, 3, { kind: NODE_REFERENCE_KIND, id: '簽署任務' })
    expect(inserted.value).toBe('@node:[簽署任務] ')
  })
})
