import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ListRowProps {
  active: boolean
  onClick: () => void
  /**
   * `sidebar`: dense rounded row with sidebar-* tokens, for navigation.
   * `content`: full-width bordered row with accent hover,
   * for primary content lists like Skills or Proposals.
   */
  variant?: 'sidebar' | 'content'
  className?: string
  /** Forwarded to the native `title` attribute, for tooltip text when the row is icon-only. */
  title?: string | undefined
  /**
   * Optional left-edge identity stripe.
   * Used by the multi-server sidebar to mark a workspace's remote.
   * Sits inside the row's `<li>` alongside the active indicator,
   * so server identity stays visible even when the row is not selected.
   */
  stripeClassName?: string
  stripeDim?: boolean
  /**
   * A control at the row's trailing edge, beside the click target not inside it,
   * since a button cannot be a descendant of a button.
   * The row reserves its width whether or not it is showing,
   * so a title does not reflow when a pointer arrives.
   */
  trailing?: ReactNode
  children: ReactNode
}

/**
 * Standard list-row pattern,
 * with a 3px purple active bar flush against the left edge.
 * Used by every selectable list in Studio,
 * so the visual language stays consistent,
 * across hover transition, active bg, and bar position.
 */
export function ListRow({ active, onClick, variant = 'content', className, title, stripeClassName, stripeDim, trailing, children }: ListRowProps) {
  const tokens = variant === 'sidebar'
    ? {
        bar: 'inset-y-1',
        button: cn(
          'group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-150',
          'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
          active && 'bg-sidebar-accent text-sidebar-foreground',
          trailing && 'pr-8',
        ),
        trailing: 'right-2.5 top-2',
      }
    : {
        bar: 'inset-y-2',
        button: cn(
          'flex w-full border-b border-border px-4 py-3 text-left transition-colors duration-150 hover:bg-accent',
          active && 'bg-accent',
          trailing && 'pr-10',
        ),
        trailing: 'right-4 top-3',
      }
  // The group is the row rather than the click target,
  // so a trailing control outside that target still knows the pointer is here.
  return (
    <li className="group/row relative">
      {stripeClassName && (
        <span
          className={cn(
            'absolute left-0 w-[2px] rounded-r-full',
            tokens.bar,
            stripeClassName,
            stripeDim ? 'opacity-40' : 'opacity-90',
          )}
          aria-hidden
        />
      )}
      {active && (
        <span className={cn('absolute w-[3px] rounded-r-full bg-primary', stripeClassName ? 'left-[2px]' : 'left-0', tokens.bar)} />
      )}
      <button type="button" onClick={onClick} title={title} className={cn(tokens.button, className)}>
        {children}
      </button>
      {trailing && <div className={cn('absolute flex items-start', tokens.trailing)}>{trailing}</div>}
    </li>
  )
}

/**
 * A row's title, clamped to two lines.
 *
 * The clamp sits on a block child rather than on the flex item itself.
 * A flex item's display is blockified,
 * so `-webkit-box` silently becomes `flow-root`, the clamp stops working,
 * and the box still cuts the last line in half.
 * Every list here puts its rows in a flex container, so every one had it.
 *
 * Two lines rather than each list choosing,
 * because rows of wildly different heights stop three queues reading as one.
 */
export function ListRowTitle({ className, children }: { className?: string, children: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <p className={cn('line-clamp-2 break-words text-xs leading-relaxed text-foreground/90', className)}>
        {children}
      </p>
    </div>
  )
}
