import type { ReactNode } from 'react'

// Shared master-detail frame for workspace surfaces.
// The list-column width and the detail region live here once,
// so every surface reads as the same product instead of drifting per page.
export function SurfaceLayout({ list, children }: { list: ReactNode, children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border">
        {list}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}
