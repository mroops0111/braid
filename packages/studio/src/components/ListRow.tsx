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
  children: ReactNode
}

/**
 * Standard list-row pattern,
 * with a 3px purple active bar flush against the left edge.
 * Used by every selectable list in Studio,
 * so the visual language stays consistent,
 * across hover transition, active bg, and bar position.
 */
export function ListRow({ active, onClick, variant = 'content', className, title, stripeClassName, stripeDim, children }: ListRowProps) {
  const tokens = variant === 'sidebar'
    ? {
        bar: 'inset-y-1',
        button: cn(
          'group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-150',
          'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
          active && 'bg-sidebar-accent text-sidebar-foreground',
        ),
      }
    : {
        bar: 'inset-y-2',
        button: cn(
          'flex w-full border-b border-border px-4 py-3 text-left transition-colors duration-150 hover:bg-accent',
          active && 'bg-accent',
        ),
      }
  return (
    <li className="relative">
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
    </li>
  )
}
