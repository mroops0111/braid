/** How many candidates a menu lists before it stops and says how many more. */
export const MENU_CANDIDATE_LIMIT = 20

/**
 * How many rows stand open before the rest are reached by scrolling.
 *
 * Kept small because the menu sits over what is being typed,
 * and a reader who cannot see their own words has lost more than they gained.
 */
export const MENU_VISIBLE_ROWS = 5

/** One row is the text-xs line box plus its vertical padding, in px. */
const ROW_HEIGHT_PX = 31
const LIST_PADDING_PX = 8
/** Kept clear of the viewport edge, so the menu never sits flush against it. */
const VIEWPORT_MARGIN_PX = 8

/** What the menu takes when nothing is crowding it. */
export const MENU_PREFERRED_HEIGHT_PX = MENU_VISIBLE_ROWS * ROW_HEIGHT_PX + LIST_PADDING_PX

/**
 * Where the menu's left edge goes, so it stays on screen.
 *
 * Follows the caret while there is room,
 * and stops short of both the container's right edge and the window's.
 * A menu that runs past either loses the ids on its right,
 * which are the part a reader picks by.
 * Both edges are checked, since a container can be wider than the window.
 *
 * Never negative.
 * A container narrower than the menu has no good left edge to offer,
 * and the menu's own `max-width` handles that overflow.
 */
export function clampMenuLeft(input: {
  readonly caretLeft: number
  readonly containerLeft: number
  readonly containerWidth: number
  readonly menuWidth: number
  readonly viewportWidth: number
}): number {
  const wanted = input.caretLeft - input.containerLeft
  const withinContainer = input.containerWidth - input.menuWidth
  const withinViewport = input.viewportWidth - VIEWPORT_MARGIN_PX - input.menuWidth - input.containerLeft
  return Math.max(0, Math.min(wanted, withinContainer, withinViewport))
}

export interface MenuPlacement {
  readonly flipUp: boolean
  /** What the menu may take on the side it landed on. */
  readonly maxHeightPx: number
}

/**
 * Which side of the caret the menu opens on, and how tall it may be there.
 *
 * Opens downward while the preferred height fits, since that is the habit.
 * Where it does not, it takes the roomier side and shrinks to what is there,
 * so a cramped menu scrolls rather than running off screen.
 */
export function placeMenu(input: {
  readonly caretTop: number
  readonly caretBottom: number
  readonly viewportHeight: number
  readonly gap: number
}): MenuPlacement {
  const below = input.viewportHeight - input.caretBottom - input.gap - VIEWPORT_MARGIN_PX
  const above = input.caretTop - input.gap - VIEWPORT_MARGIN_PX
  const flipUp = below < MENU_PREFERRED_HEIGHT_PX && above > below
  return {
    flipUp,
    maxHeightPx: Math.max(0, Math.min(MENU_PREFERRED_HEIGHT_PX, flipUp ? above : below)),
  }
}

/**
 * How many matches the menu stopped short of listing.
 *
 * Zero where nothing was cut,
 * so a reader who sees everything is not told there is more.
 * An absent total means the caller tracks none,
 * which reads the same as nothing being cut.
 */
export function hiddenMatchCount(shown: number, total: number | undefined): number {
  return Math.max(0, (total ?? shown) - shown)
}

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
 * One definition for the mention menu and the picker,
 * so a key cannot mean different things in the two.
 * Callers map the outcome onto their own state,
 * which is where they genuinely differ.
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
      // A modified Enter is a host shortcut such as submit.
      // Stealing it would strand the reader inside the menu with no way to send.
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
