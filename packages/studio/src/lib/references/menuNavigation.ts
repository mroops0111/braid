/** How many candidates a menu offers before it stops listing. */
export const MENU_CANDIDATE_LIMIT = 8

export type MenuKeyOutcome = 'move-next' | 'move-previous' | 'pick' | 'dismiss' | null

/** The parts of a key press the menu cares about, so this stays free of React. */
export interface MenuKeyPress {
  readonly key: string
  readonly metaKey?: boolean
  readonly ctrlKey?: boolean
  readonly isComposing?: boolean
}

/**
 * Reads a key press as a candidate-menu action.
 * One definition shared by the mention menu and the picker, since the two
 * drifted apart while each kept its own copy. Callers map the outcome onto
 * their own state, which is where they genuinely differ.
 */
export function readMenuKey(press: MenuKeyPress): MenuKeyOutcome {
  // An IME owns the keyboard while composing. Enter confirms its candidate,
  // never a menu candidate.
  if (press.isComposing)
    return null
  switch (press.key) {
    case 'ArrowDown':
      return 'move-next'
    case 'ArrowUp':
      return 'move-previous'
    case 'Tab':
      return 'pick'
    case 'Enter':
      // A modified Enter is a host shortcut such as submit. Stealing it would
      // strand the reader inside the menu with no way to send.
      return press.metaKey === true || press.ctrlKey === true ? null : 'pick'
    case 'Escape':
      return 'dismiss'
    default:
      return null
  }
}

/**
 * Narrows a React keyboard event to the parts above.
 * Typed structurally so this module needs no React import.
 */
export function toMenuKeyPress(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  nativeEvent: { isComposing?: boolean }
}): MenuKeyPress {
  return {
    key: event.key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    isComposing: event.nativeEvent.isComposing === true,
  }
}

/** Wraps around both ends, so the highlight never falls off the list. */
export function stepIndex(current: number, total: number, delta: number): number {
  if (total <= 0)
    return 0
  return (current + delta + total) % total
}
