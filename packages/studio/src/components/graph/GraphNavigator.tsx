import type { GraphNode, NodeId, NodeTypeId } from '@telos/schema'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { nodeTypeStyle } from './NodeTypeBadge'

export interface GraphFilters {
  search: string
  typeFilter: NodeTypeId | null
  orphansOnly: boolean
  draftOnly: boolean
}

interface GraphNavigatorProps {
  nodes: readonly GraphNode[]
  orphanIds: ReadonlySet<NodeId>
  filters: GraphFilters
  onFiltersChange: (filters: GraphFilters) => void
  selectedId: NodeId | null
  onSelect: (nodeId: NodeId) => void
}

export function GraphNavigator({ nodes, orphanIds, filters, onFiltersChange, selectedId, onSelect }: GraphNavigatorProps) {
  const grouped = useMemo(() => groupByType(nodes, filters), [nodes, filters])
  const total = grouped.reduce((sum, group) => sum + group.nodes.length, 0)

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="p-2">
        <SearchInput value={filters.search} onChange={search => onFiltersChange({ ...filters, search })} />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          By Type (
          {total}
          )
        </div>
        <ul className="pb-2">
          {grouped.length === 0 && (
            <li className="px-3 py-1.5 text-[11px] text-sidebar-foreground/40">
              No nodes match the filter.
            </li>
          )}
          {grouped.map(group => (
            <TypeGroup
              key={group.type}
              type={group.type}
              nodes={group.nodes}
              selectedId={selectedId}
              filteredType={filters.typeFilter}
              onFilterType={(type) => {
                const next = filters.typeFilter === type ? null : type
                onFiltersChange({ ...filters, typeFilter: next })
              }}
              onSelect={onSelect}
            />
          ))}
        </ul>

        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Filters
        </div>
        <ul className="space-y-0.5 px-2 pb-3">
          <FilterCheckbox
            checked={filters.orphansOnly}
            onChange={orphansOnly => onFiltersChange({ ...filters, orphansOnly })}
            label={`Orphans only (${orphanIds.size})`}
            disabled={orphanIds.size === 0}
          />
          <FilterCheckbox
            checked={filters.draftOnly}
            onChange={draftOnly => onFiltersChange({ ...filters, draftOnly })}
            label="Status: draft"
          />
        </ul>
      </div>
    </aside>
  )
}

function SearchInput({ value, onChange }: { value: string, onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/40" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search nodes…"
        className="w-full rounded-md border border-sidebar-border bg-background pl-7 pr-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  )
}

function TypeGroup({ type, nodes, selectedId, filteredType, onFilterType, onSelect }: {
  type: NodeTypeId
  nodes: readonly GraphNode[]
  selectedId: NodeId | null
  filteredType: NodeTypeId | null
  onFilterType: (type: NodeTypeId) => void
  onSelect: (nodeId: NodeId) => void
}) {
  const [open, setOpen] = useState(true)
  const style = nodeTypeStyle(type)
  const isFilteredHere = filteredType === type

  return (
    <li>
      <div className="flex items-center px-2 py-1 text-[11px]">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex h-5 w-5 items-center justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <button
          type="button"
          onClick={() => onFilterType(type)}
          className={cn(
            'ml-0.5 flex flex-1 items-center justify-between rounded-sm px-1 py-0.5 text-left transition-colors',
            isFilteredHere ? 'bg-accent text-foreground' : 'text-sidebar-foreground/80 hover:bg-accent hover:text-foreground',
          )}
          title={isFilteredHere ? 'Filtering canvas to this type. Click to clear.' : 'Click to filter canvas to this type.'}
        >
          <span className="flex items-center gap-1.5 font-mono uppercase tracking-wider">
            <span className={cn('size-1.5 rounded-full', style.bar)} />
            {type}
          </span>
          <span className="text-sidebar-foreground/40">{nodes.length}</span>
        </button>
      </div>
      {open && (
        <ul className="ml-5 space-y-px pb-1">
          {nodes.map(node => (
            <li key={node.id} className="relative">
              {node.id === selectedId && (
                <span className={cn('absolute inset-y-1 left-0 w-[3px] rounded-r-full', style.bar)} />
              )}
              <button
                type="button"
                onClick={() => onSelect(node.id)}
                className={cn(
                  'flex w-full items-center gap-1.5 truncate rounded-sm px-2 py-0.5 text-left text-[11px] transition-colors duration-150',
                  node.id === selectedId
                    ? 'bg-accent text-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-accent hover:text-foreground',
                )}
              >
                <span className="truncate">{node.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function FilterCheckbox({ checked, onChange, label, disabled }: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <li>
      <label className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-[11px]',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-accent',
      )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
          className="size-3 accent-primary"
        />
        <span>{label}</span>
      </label>
    </li>
  )
}

interface TypeGroupData {
  type: NodeTypeId
  nodes: readonly GraphNode[]
}

function groupByType(nodes: readonly GraphNode[], filters: GraphFilters): TypeGroupData[] {
  const filtered = nodes.filter(node => matches(node, filters))
  const map = new Map<NodeTypeId, GraphNode[]>()
  for (const node of filtered) {
    const bucket = map.get(node.type) ?? []
    bucket.push(node)
    map.set(node.type, bucket)
  }
  return [...map.entries()]
    .map(([type, list]) => ({
      type,
      nodes: list.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.type.localeCompare(b.type))
}

function matches(node: GraphNode, filters: GraphFilters): boolean {
  if (filters.search) {
    const needle = filters.search.toLowerCase()
    if (!node.name.toLowerCase().includes(needle) && !node.id.toLowerCase().includes(needle))
      return false
  }
  if (filters.draftOnly && node.status !== 'draft')
    return false
  return true
}
