import { describe, expect, it } from 'vitest'
import { readMenuKey, stepIndex, toMenuKeyPress } from '../../../src/lib/references/menuNavigation'

describe('readMenuKey', () => {
  it('maps the arrows to a move', () => {
    expect(readMenuKey({ key: 'ArrowDown' })).toBe('move-next')
    expect(readMenuKey({ key: 'ArrowUp' })).toBe('move-previous')
  })

  it('picks on a bare Enter or Tab', () => {
    expect(readMenuKey({ key: 'Enter' })).toBe('pick')
    expect(readMenuKey({ key: 'Tab' })).toBe('pick')
  })

  it('leaves a modified Enter to the host, which owns submit', () => {
    expect(readMenuKey({ key: 'Enter', metaKey: true })).toBeNull()
    expect(readMenuKey({ key: 'Enter', ctrlKey: true })).toBeNull()
  })

  it('leaves every key alone while an IME composes', () => {
    expect(readMenuKey({ key: 'Enter', isComposing: true })).toBeNull()
    expect(readMenuKey({ key: 'ArrowDown', isComposing: true })).toBeNull()
  })

  it('dismisses on Escape', () => {
    expect(readMenuKey({ key: 'Escape' })).toBe('dismiss')
  })

  it('ignores ordinary typing', () => {
    expect(readMenuKey({ key: 'a' })).toBeNull()
    expect(readMenuKey({ key: 'ArrowLeft' })).toBeNull()
  })
})

describe('toMenuKeyPress', () => {
  it('narrows a react event down to the parts the menu reads', () => {
    expect(toMenuKeyPress({
      key: 'Enter',
      metaKey: true,
      ctrlKey: false,
      nativeEvent: { isComposing: true },
    })).toEqual({ key: 'Enter', metaKey: true, ctrlKey: false, isComposing: true })
  })

  it('treats a missing composition flag as not composing', () => {
    expect(toMenuKeyPress({ key: 'a', metaKey: false, ctrlKey: false, nativeEvent: {} }).isComposing).toBe(false)
  })
})

describe('stepIndex', () => {
  it('moves within the list', () => {
    expect(stepIndex(0, 3, 1)).toBe(1)
    expect(stepIndex(2, 3, -1)).toBe(1)
  })

  it('wraps around both ends', () => {
    expect(stepIndex(2, 3, 1)).toBe(0)
    expect(stepIndex(0, 3, -1)).toBe(2)
  })

  it('stays at zero for an empty list', () => {
    expect(stepIndex(0, 0, 1)).toBe(0)
  })
})
