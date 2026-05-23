import { Focus as FocusIcon, LayoutGrid, Network } from 'lucide-react'
import { cn } from '@/lib/utils'

export type GraphView = 'visualization' | 'table'

/**
 * Page-actions toolbar atoms shared by the Graph page and the
 * Proposals preview. Live here (not in any page) so neither page
 * imports the other — both consume a common toolkit.
 *
 * Visual language matches the sibling icon group: same border, same
 * card background; active state uses the `accent` token so Focus and
 * the active view chip read as members of the same cluster.
 */

export function FocusToggle({ active, onChange }: { active: boolean, onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      aria-pressed={active}
      title={active ? 'Show full graph' : 'Focus on neighbourhood'}
      className={cn(
        'flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] shadow-sm transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <FocusIcon className="size-3.5" />
      Focus
    </button>
  )
}

export function ViewToggle({ view, onChange }: { view: GraphView, onChange: (view: GraphView) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Graph view"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-sm"
    >
      <ToggleButton
        active={view === 'visualization'}
        onClick={() => onChange('visualization')}
        ariaLabel="Visualization view (Cmd+1)"
      >
        <Network className="size-3.5" />
      </ToggleButton>
      <ToggleButton
        active={view === 'table'}
        onClick={() => onChange('table')}
        ariaLabel="Table view (Cmd+2)"
      >
        <LayoutGrid className="size-3.5" />
      </ToggleButton>
    </div>
  )
}

function ToggleButton({ active, onClick, ariaLabel, children }: {
  active: boolean
  onClick: () => void
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-sm transition-colors duration-150',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
