import { Focus as FocusIcon, GitCompare, LayoutGrid, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type GraphView = 'visualization' | 'table'

/**
 * Mode switch for the selected node's neighbourhood.
 *
 * A mode rather than an action,
 * so it sits with the view switch instead of in the canvas cluster,
 * where every other control fires once and returns. Always rendered,
 * and disabled without a selection,
 * since appearing only when one exists shifted whatever stood beside it.
 */
export function FocusToggle({ active, disabled, onChange }: {
  active: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      disabled={disabled}
      aria-pressed={active}
      title={active ? t('graph.toolbar.showFullGraphTooltip') : t('graph.toolbar.focusNeighbourhoodTooltip')}
      className={cn(
        'flex h-7 items-center gap-1 rounded-md border border-border px-2 text-2xs font-medium uppercase tracking-wider shadow-sm transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-accent text-foreground'
          : 'bg-card text-muted-foreground enabled:hover:bg-accent/50 enabled:hover:text-foreground',
      )}
    >
      <FocusIcon className="size-3.5" />
      {t('graph.toolbar.focusButton')}
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
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      aria-pressed={active}
      title={active ? t('graph.toolbar.showFullGraphTooltip') : t('graph.toolbar.dimUnchangedTooltip')}
      className={cn(
        'flex h-7 items-center gap-1 rounded-md border border-border px-2 text-2xs font-medium uppercase tracking-wider shadow-sm transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <GitCompare className="size-3.5" />
      {t('graph.toolbar.onlyChangesButton')}
    </button>
  )
}

export function ViewToggle({ view, onChange }: { view: GraphView, onChange: (view: GraphView) => void }) {
  const { t } = useTranslation()
  return (
    <div
      role="tablist"
      aria-label={t('graph.toolbar.graphView')}
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-sm"
    >
      <ToggleButton
        active={view === 'visualization'}
        onClick={() => onChange('visualization')}
        ariaLabel={t('graph.toolbar.visualizationViewButton')}
      >
        <Network className="size-3.5" />
      </ToggleButton>
      <ToggleButton
        active={view === 'table'}
        onClick={() => onChange('table')}
        ariaLabel={t('graph.toolbar.tableViewButton')}
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
