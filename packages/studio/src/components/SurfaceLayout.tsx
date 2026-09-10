import type { ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

/**
 * Shared master-detail frame for workspace surfaces.
 *
 * The list-column width and the detail region live here once, so every
 * surface reads as the same product instead of drifting per page. Sized as a
 * flex-1 child, so it fills a `flex h-full flex-col` page root, below any
 * PageActions header the page mounts.
 *
 * Collapsing belongs here too. Written per page it existed on exactly one
 * surface, which taught a reader an affordance that then went missing
 * wherever else they looked for it.
 */
export function SurfaceLayout({ list, listClassName, collapse, children }: {
  list: ReactNode
  listClassName?: string
  /**
   * Offered only when the page can do without its list.
   *
   * `collapsed` is the page's state rather than this component's, since a
   * surface that lands with the list already put away has to say so before
   * anything renders.
   */
  collapse?: {
    readonly collapsed: boolean
    readonly onToggle: (next: boolean) => void
    /** What the reopen control says it will bring back. */
    readonly showLabel: string
  }
  children: ReactNode
}) {
  if (collapse?.collapsed) {
    return (
      <div className="flex min-h-0 flex-1">
        <div className="flex w-9 shrink-0 flex-col items-center border-r border-border pt-2.5">
          <Button
            variant="ghost"
            size="xs"
            className="[&_svg]:size-3.5"
            title={collapse.showLabel}
            aria-label={collapse.showLabel}
            onClick={() => collapse.onToggle(false)}
          >
            <PanelLeftOpen />
          </Button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className={cn('flex w-72 shrink-0 flex-col border-r border-border', listClassName)}>
        {list}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}

/** The control that puts a list away, for the header slot it sits in. */
export function CollapseListButton({ label, onCollapse }: { label: string, onCollapse: () => void }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className="[&_svg]:size-3.5"
      title={label}
      aria-label={label}
      onClick={onCollapse}
    >
      <PanelLeftClose />
    </Button>
  )
}
