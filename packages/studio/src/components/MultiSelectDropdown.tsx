import { Check, ChevronDown, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

export interface MultiSelectOption {
  value: string
  label: string
  description?: string | undefined
}

interface MultiSelectDropdownProps {
  /** id assigned to the trigger button — pair with an upstream `<label htmlFor>` for a11y. */
  id?: string
  /** Used in the closed-state summary when nothing is selected ("Select {label}…"). */
  label: string
  options: readonly MultiSelectOption[]
  selected: readonly string[]
  onToggle: (value: string, checked: boolean) => void
  disabled?: boolean
}

/**
 * Generic multi-select with a search filter and selected-as-chips
 * overflow line. Decoupled from any specific data shape — callers
 * pass plain `{ value, label, description? }` options. Built on
 * Radix Popover so click-outside and Escape close the menu without
 * extra wiring.
 */
export function MultiSelectDropdown({
  id,
  label,
  options,
  selected,
  onToggle,
  disabled = false,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q)
      return options
    return options.filter(o =>
      o.label.toLowerCase().includes(q)
      || o.value.toLowerCase().includes(q)
      || (o.description?.toLowerCase().includes(q) ?? false),
    )
  }, [options, query])

  const summary = summariseSelection(selected, options, label)

  return (
    <div className="space-y-1.5">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled || options.length === 0}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-left text-xs text-foreground transition-colors',
              'focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50',
              !disabled && 'hover:bg-accent',
            )}
          >
            <span className={cn('truncate', selected.length === 0 && 'text-muted-foreground')}>
              {summary}
            </span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="z-50 w-[var(--radix-popover-trigger-width)] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md"
            align="start"
            sideOffset={4}
          >
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter…"
              className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
              {filtered.length === 0 && (
                <li className="px-1 py-2 text-[11px] text-muted-foreground">No matches.</li>
              )}
              {filtered.map((option) => {
                const checked = selectedSet.has(option.value)
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      onClick={() => onToggle(option.value, !checked)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-sm px-1.5 py-1 text-left text-xs text-foreground transition-colors',
                        'hover:bg-accent',
                        checked && 'bg-accent/40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded border',
                          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                        )}
                      >
                        {checked && <Check className="size-2.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[11px]">{option.label}</span>
                        {option.description && (
                          <span className="block truncate text-[10px] text-muted-foreground">{option.description}</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {selected.length > 0 && (
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[10px] text-muted-foreground">
                <span>
                  {selected.length}
                  {' '}
                  selected
                </span>
                <button
                  type="button"
                  onClick={() => selected.forEach(v => onToggle(v, false))}
                  className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
                >
                  Clear all
                </button>
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {selected.length > 0 && (
        <SelectedChips
          options={options}
          selected={selected}
          onRemove={value => onToggle(value, false)}
        />
      )}
    </div>
  )
}

function SelectedChips({
  options,
  selected,
  onRemove,
}: {
  options: readonly MultiSelectOption[]
  selected: readonly string[]
  onRemove: (value: string) => void
}) {
  const optionsByValue = useMemo(() => new Map(options.map(o => [o.value, o])), [options])
  return (
    <ul className="flex flex-wrap gap-1">
      {selected.map((value) => {
        const option = optionsByValue.get(value)
        return (
          <li key={value}>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-foreground">
              <span className="max-w-[12rem] truncate font-mono">{option?.label ?? value}</span>
              <button
                type="button"
                onClick={() => onRemove(value)}
                aria-label={`Remove ${option?.label ?? value}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-2.5" />
              </button>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function summariseSelection(
  selected: readonly string[],
  options: readonly MultiSelectOption[],
  label: string,
): string {
  if (selected.length === 0)
    return `Select ${label}…`
  if (selected.length === 1) {
    const value = selected[0]!
    const option = options.find(o => o.value === value)
    return option?.label ?? value
  }
  return `${selected.length} selected`
}
