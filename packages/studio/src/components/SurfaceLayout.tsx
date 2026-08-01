import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Shared master-detail frame for workspace surfaces.
// The list-column width and the detail region live here once,
// so every surface reads as the same product instead of drifting per page.
// Sized as a flex-1 child, so it fills a `flex h-full flex-col` page root,
// below any PageActions header the page mounts.
export function SurfaceLayout({ list, listClassName, children }: { list: ReactNode, listClassName?: string, children: ReactNode }) {
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
