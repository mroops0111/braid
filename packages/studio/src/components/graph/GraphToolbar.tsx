import { Focus as FocusIcon, LayoutGrid, Network, SquareDashed } from 'lucide-react'
import { cn } from '@/lib/utils'

export type GraphView = 'visualization' | 'table'

/**
 * Page-actions toolbar atoms shared by the Graph page,
 * and the Proposals preview.
 * They live here, not in any page,
 * so neither page imports the other, both consume a common toolkit.
 *
 * Visual language matches the sibling icon group.
 * Same border, same card background,
 * and the active state uses the `accent` token,
 * so Focus and the active view chip read as members of one cluster.
 */

export function FocusToggle({ active, onChange }: { active: boolean, onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      aria-pressed={active}
      title={active ? 'Show full graph' : 'Focus on neighbourhood'}
      className={cn(
        'flex h-7 items-center gap-1 rounded-md border border-border px-2 text-2xs shadow-sm transition-colors',
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

/**
 * Toggle for proposal preview.
 * Dims every node and edge that this proposal does not touch.
 * Restores the "I only want to see what changed" experience,
 * for incremental proposals where adds, updates, and removes,
 * make up a small fraction of the total snapshot.
 * Unaffected nodes stay visible and faded,
 * so reviewers retain topology context.
 * See `DIMMED_NODE_OPACITY` in `styleTokens.ts`.
 */
export function OnlyChangesToggle({ active, onChange }: { active: boolean, onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      aria-pressed={active}
      title={active ? 'Show full graph' : 'Dim unchanged nodes & edges'}
      className={cn(
        'flex h-7 items-center gap-1 rounded-md border border-border px-2 text-2xs shadow-sm transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <SquareDashed className="size-3.5" />
      Only changes
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
