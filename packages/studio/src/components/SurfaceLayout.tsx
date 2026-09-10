import type { ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

/**
 * The one control that puts a column away and brings it back.
 *
 * One glyph pair, one size, one hit area, wherever a surface offers it. Built
 * per place it had become a ghost button here and a bordered chip there, so a
 * reader crossing between two surfaces could not tell it was the same control.
 *
 * `floating` is the single exception, for a control with no band to sit in.
 * Laid over a canvas it needs a ground of its own or it disappears into
 * whatever is drawn behind it, which is a legibility problem rather than a
 * second opinion about how the control should look.
 */
export function PanelToggle({ open, label, onToggle, floating = false, className }: {
  open: boolean
  label: string
  onToggle: () => void
  floating?: boolean
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn('[&_svg]:size-3.5', floating && 'border border-border bg-card shadow-sm hover:bg-accent', className)}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      {open ? <PanelLeftClose /> : <PanelLeftOpen />}
    </Button>
  )
}

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
      // No narrow column left behind. A 36px strip with a border down its
      // full height reads as a column that happens to be empty, and the one
      // thing in it is a button. The reader gets a gutter the control sits
      // in instead, which is what the graph has always done beside its
      // canvas.
      <div className="relative flex min-h-0 flex-1">
        <div className="absolute left-1.5 top-2 z-10">
          <PanelToggle open={false} label={collapse.showLabel} onToggle={() => collapse.onToggle(false)} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden pl-9">
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

/** The control as a band's trailing action, where a list is open to be put away. */
export function CollapseListButton({ label, onCollapse }: { label: string, onCollapse: () => void }) {
  return <PanelToggle open label={label} onToggle={onCollapse} />
}
