import type { GraphNode, NodeId, NodeTypeId, OntologyResponse } from '@braidhq/schema'
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOntology } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { PaletteProvider, usePalette, usePaletteContext } from './usePalette'

export interface GraphFilters {
  /** Free-text query against node `name` and `description`. */
  search: string
  /** Whitelist of node types to keep. Empty = none shown. */
  types: NodeTypeId[]
  orphansOnly: boolean
}

interface GraphNavigatorProps {
  workspaceId: string
  nodes: readonly GraphNode[]
  orphanIds: ReadonlySet<NodeId>
  filters: GraphFilters
  onFiltersChange: (filters: GraphFilters) => void
}

export function GraphNavigator({ workspaceId, nodes, orphanIds, filters, onFiltersChange }: GraphNavigatorProps) {
  const { t } = useTranslation()
  // Build the localized palette here rather than read context,
  // since the navigator renders outside GraphCanvas's PaletteProvider.
  // Provide it to the filter rows and legend below.
  const palette = usePalette(workspaceId)
  const { data: ontology } = useOntology(workspaceId)
  const typeCounts = useMemo(
    () => countByType(nodes, palette.sortNodeTypes.bind(palette)),
    [nodes, palette],
  )
  const allTypes = useMemo(() => typeCounts.map(t => t.type), [typeCounts])
  const everyTypeSelected = filters.types.length > 0 && filters.types.length === allTypes.length
  const noTypeSelected = filters.types.length === 0

  function toggleType(type: NodeTypeId): void {
    const next = filters.types.includes(type)
      ? filters.types.filter(t => t !== type)
      : [...filters.types, type]
    onFiltersChange({ ...filters, types: next })
  }

  return (
    <PaletteProvider value={palette}>
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
        <div className="border-b border-sidebar-border p-2">
          <SearchInput value={filters.search} onChange={search => onFiltersChange({ ...filters, search })} />
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="flex items-center justify-between px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            <span>{t('graph.navigator.filterByType')}</span>
            <div className="flex gap-2 text-2xs normal-case tracking-normal">
              <button
                type="button"
                disabled={everyTypeSelected}
                onClick={() => onFiltersChange({ ...filters, types: allTypes })}
                className="text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground disabled:opacity-30"
              >
                {t('common.all')}
              </button>
              <button
                type="button"
                disabled={noTypeSelected}
                onClick={() => onFiltersChange({ ...filters, types: [] })}
                className="text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground disabled:opacity-30"
              >
                {t('common.none')}
              </button>
            </div>
          </div>
          <ul className="space-y-px px-1">
            {typeCounts.map(({ type, count }) => (
              <TypeFilterRow
                key={type}
                type={type}
                count={count}
                active={filters.types.includes(type)}
                onToggle={() => toggleType(type)}
              />
            ))}
          </ul>

          {orphanIds.size > 0 && (
            <label className="mx-1 mt-2 flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-2xs hover:bg-accent">
              <input
                type="checkbox"
                checked={filters.orphansOnly}
                onChange={e => onFiltersChange({ ...filters, orphansOnly: e.target.checked })}
                className="size-3 accent-primary"
              />
              <span>{t('graph.navigator.orphansOnly', { count: orphanIds.size })}</span>
            </label>
          )}
        </div>

        <Legend ontology={ontology} />
      </aside>
    </PaletteProvider>
  )
}

function SearchInput({ value, onChange }: { value: string, onChange: (value: string) => void }) {
  const { t } = useTranslation()
  return (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/40" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={t('graph.navigator.searchPlaceholder')}
        className="w-full rounded-md border border-sidebar-border bg-background pl-7 pr-2 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  )
}

function TypeFilterRow({ type, count, active, onToggle }: {
  type: NodeTypeId
  count: number
  active: boolean
  onToggle: () => void
}) {
  const palette = usePaletteContext()
  return (
    <li className="relative">
      {active && (
        <span className="absolute inset-y-1 left-0 w-[3px] rounded-r-full" style={palette.nodeDotStyle(type)} />
      )}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-2xs transition-colors duration-150',
          active
            ? 'bg-accent text-foreground'
            : 'text-sidebar-foreground/80 hover:bg-accent hover:text-foreground',
        )}
        aria-pressed={active}
      >
        <span className="size-2 rounded-full" style={palette.nodeDotStyle(type)} />
        <span className="flex-1 font-medium uppercase tracking-wider">{palette.nodeLabel(type)}</span>
        <span className="text-sidebar-foreground/40">{count}</span>
        {active && <Check className="size-3 text-primary" />}
      </button>
    </li>
  )
}

function Legend({ ontology }: { ontology: OntologyResponse | undefined }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const palette = usePaletteContext()
  return (
    <div className="border-t border-sidebar-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground"
      >
        <span>{t('graph.navigator.legend')}</span>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>
      {open && ontology && (
        <div className="space-y-3 px-3 pb-3 text-2xs">
          <section>
            <div className="mb-1 text-sidebar-foreground/50">{t('graph.navigator.nodeTypes')}</div>
            <ul className="space-y-0.5">
              {ontology.nodeTypes.map(descriptor => (
                <li key={descriptor.id} className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={palette.nodeDotStyle(descriptor.id)} />
                  <span className="text-sidebar-foreground/80">{palette.nodeLabel(descriptor.id)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <div className="mb-1 text-sidebar-foreground/50">{t('graph.navigator.edgeTypes')}</div>
            <ul className="space-y-0.5">
              {ontology.edgeTypes.map(descriptor => (
                <li key={descriptor.id} className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-4" style={{ backgroundColor: palette.edgeColor(descriptor.id) }} />
                  <span className="text-sidebar-foreground/80">{palette.edgeLabel(descriptor.id)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}

function countByType(
  nodes: readonly GraphNode[],
  sortByOntology: (types: NodeTypeId[]) => NodeTypeId[],
): { type: NodeTypeId, count: number }[] {
  const counts = new Map<NodeTypeId, number>()
  for (const node of nodes)
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  return sortByOntology([...counts.keys()]).map(type => ({ type, count: counts.get(type) ?? 0 }))
}
