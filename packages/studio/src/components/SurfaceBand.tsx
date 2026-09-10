import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The one band a surface puts above a column.
 *
 * A reader moves between Ask, the Inbox and History without changing what
 * they are doing: picking one thing out of a queue, then reading it. Built
 * per page, the band became a 44px bar on one surface, a taller strip of tabs
 * on another, and nothing at all on a third, so both the list and the record
 * beside it started at a different height each time.
 *
 * One height, and the two columns share it, which is the part that makes them
 * line up rather than merely resemble each other. Stacking a title over a row
 * of filters would break that again, so whatever a surface has goes in this
 * row: a name and what can be done to the queue, or which part of it is
 * shown, or which reading of a record is open.
 */
export function SurfaceBand({ title, className, children }: {
  /** What this column is, in the small caps every heading in the chrome takes. */
  title?: string
  className?: string
  /** Filters, view tabs, or anything the reader can act on from here. */
  children?: ReactNode
}) {
  return (
    <div className={cn('flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3', className)}>
      {title && (
        <span className="truncate text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      )}
      {children && <div className="flex min-w-0 shrink-0 items-center gap-0.5">{children}</div>}
    </div>
  )
}
