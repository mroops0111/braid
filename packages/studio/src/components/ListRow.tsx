import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ListRowProps {
  active: boolean
  onClick: () => void
  /**
   * `sidebar`: dense rounded row with sidebar-* tokens (used for navigation).
   * `content`: full-width bordered row with accent hover (used for primary
   *            content lists like Skills / Proposals).
   */
  variant?: 'sidebar' | 'content'
  className?: string
  children: ReactNode
}

/**
 * Standard list-row pattern with a 3px purple active bar flush against the
 * left edge. Used by every selectable list in Studio so the visual language
 * (hover transition, active bg, bar position) stays consistent.
 */
export function ListRow({ active, onClick, variant = 'content', className, children }: ListRowProps) {
  const tokens = variant === 'sidebar'
    ? {
        bar: 'inset-y-1',
        button: cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150',
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
      {active && (
        <span className={cn('absolute left-0 w-[3px] rounded-r-full bg-primary', tokens.bar)} />
      )}
      <button type="button" onClick={onClick} className={cn(tokens.button, className)}>
        {children}
      </button>
    </li>
  )
}
