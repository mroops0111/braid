import { describe, expect, it } from 'vitest'
import { clampMenuLeft, hiddenMatchCount, MENU_PREFERRED_HEIGHT_PX, placeMenu, readMenuKey, stepIndex, toMenuKeyPress } from '../../../src/lib/references/menuNavigation'

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

describe('hiddenMatchCount', () => {
  it('counts what the menu stopped short of', () => {
    expect(hiddenMatchCount(20, 33)).toBe(13)
  })

  // A menu showing everything must not claim there is more,
  // which is what counting the whole list rather than the remainder does.
  it('is zero when nothing was cut', () => {
    expect(hiddenMatchCount(3, 3)).toBe(0)
  })

  it('is zero rather than negative when the total lags the page', () => {
    expect(hiddenMatchCount(5, 2)).toBe(0)
  })

  // A caller tracking no total is saying nothing was cut,
  // not that everything was.
  it('treats an absent total as nothing hidden', () => {
    expect(hiddenMatchCount(4, undefined)).toBe(0)
  })
})

describe('placeMenu', () => {
  const gap = 4
  const roomy = { caretTop: 200, caretBottom: 220, viewportHeight: 1000, gap }

  it('opens downward and takes its preferred height where there is room', () => {
    const placement = placeMenu(roomy)
    expect(placement.flipUp).toBe(false)
    expect(placement.maxHeightPx).toBe(MENU_PREFERRED_HEIGHT_PX)
  })

  // A composer sits at the foot of the page,
  // so this is the common case rather than an edge one.
  it('flips up when the caret is near the bottom and there is more room above', () => {
    const placement = placeMenu({ caretTop: 700, caretBottom: 720, viewportHeight: 760, gap })
    expect(placement.flipUp).toBe(true)
  })

  // Roomier above is not a reason to move.
  // Jumping the caret whenever the page is scrolled down,
  // would leave the menu's side unpredictable while the room below fits.
  it('stays downward while it fits, even where above is roomier', () => {
    const placement = placeMenu({ caretTop: 600, caretBottom: 620, viewportHeight: 850, gap })
    expect(placement.flipUp).toBe(false)
    expect(placement.maxHeightPx).toBe(MENU_PREFERRED_HEIGHT_PX)
  })

  // Running off screen hides rows the reader cannot scroll back to,
  // so a cramped menu shrinks and scrolls instead.
  it('shrinks to the room it has rather than overflowing', () => {
    const placement = placeMenu({ caretTop: 60, caretBottom: 80, viewportHeight: 200, gap })
    expect(placement.maxHeightPx).toBeLessThan(MENU_PREFERRED_HEIGHT_PX)
    expect(placement.maxHeightPx).toBeGreaterThan(0)
  })

  it('never reports a negative height', () => {
    const placement = placeMenu({ caretTop: 0, caretBottom: 0, viewportHeight: 0, gap })
    expect(placement.maxHeightPx).toBe(0)
  })

  // Below is the reading habit, so a tie must not send it upward.
  it('stays downward when neither side is roomier', () => {
    const placement = placeMenu({ caretTop: 100, caretBottom: 100, viewportHeight: 200, gap })
    expect(placement.flipUp).toBe(false)
  })
})

describe('clampMenuLeft', () => {
  const container = { containerLeft: 100, containerWidth: 500, menuWidth: 400, viewportWidth: 2000 }

  it('follows the caret while the menu still fits', () => {
    expect(clampMenuLeft({ ...container, caretLeft: 150 })).toBe(50)
  })

  // Hanging off the right takes the ids with it,
  // and those are what a reader picks by.
  it('stops at the right edge rather than running past it', () => {
    expect(clampMenuLeft({ ...container, caretLeft: 550 })).toBe(100)
  })

  it('sits flush left when the caret is at the start', () => {
    expect(clampMenuLeft({ ...container, caretLeft: 100 })).toBe(0)
  })

  // A container narrower than the menu has no good left edge to offer,
  // so the menu starts at zero and its own max-width does the rest.
  it('never goes negative in a container narrower than itself', () => {
    expect(clampMenuLeft({
      caretLeft: 120,
      containerLeft: 100,
      containerWidth: 200,
      menuWidth: 400,
      viewportWidth: 2000,
    })).toBe(0)
  })

  // A panel can be wider than the window,
  // so staying inside the container is not the same as staying on screen.
  it('stops at the window edge even where the container has room', () => {
    expect(clampMenuLeft({
      caretLeft: 900,
      containerLeft: 100,
      containerWidth: 2000,
      menuWidth: 400,
      viewportWidth: 1000,
    })).toBe(492)
  })
})
