import { Check, ChevronDown, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

type TranslateFn = ReturnType<typeof useTranslation>['t']

export interface MultiSelectOption {
  value: string
  label: string
  description?: string | undefined
  /**
   * Optional informational chip rendered next to the option label.
   * Used by the source picker to mark per-unit freshness,
   * such as "processed Nm ago" or "stale". Leave unset for plain options.
   * The chip is purely informational, it does not disable selection.
   */
  badge?: {
    readonly text: string
    readonly tone?: 'fresh' | 'stale'
    readonly title?: string
  } | undefined
}

interface MultiSelectDropdownProps {
  /** id assigned to the trigger button, pair with an upstream `<label htmlFor>` for a11y. */
  id?: string
  /** Used in the closed-state summary when nothing is selected. */
  label: string
  options: readonly MultiSelectOption[]
  selected: readonly string[]
  onToggle: (value: string, checked: boolean) => void
  disabled?: boolean
}

/**
 * Generic multi-select with a search filter,
 * and a selected-as-chips overflow line.
 * Decoupled from any specific data shape,
 * callers pass plain `{ value, label, description? }` options.
 * Built on Radix Popover,
 * so click-outside and Escape close the menu without extra wiring.
 */
export function MultiSelectDropdown({
  id,
  label,
  options,
  selected,
  onToggle,
  disabled = false,
}: MultiSelectDropdownProps) {
  const { t } = useTranslation()
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

  const summary = summariseSelection(selected, options, label, t)

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
              placeholder={t('shell.multiSelect.filterPlaceholder')}
              className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
              {filtered.length === 0 && (
                <li className="px-1 py-2 text-2xs text-muted-foreground">{t('shell.multiSelect.noMatches')}</li>
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
                        <span className="flex items-center gap-1.5">
                          <span className="block truncate font-mono text-2xs">{option.label}</span>
                          {option.badge && (
                            <span
                              title={option.badge.title}
                              className={cn(
                                'shrink-0 rounded-full px-1.5 py-px text-2xs font-medium uppercase tracking-wider',
                                option.badge.tone === 'stale'
                                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                              )}
                            >
                              {option.badge.text}
                            </span>
                          )}
                        </span>
                        {option.description && (
                          <span className="block truncate text-2xs text-muted-foreground">{option.description}</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {selected.length > 0 && (
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-2xs text-muted-foreground">
                <span>
                  {t('shell.multiSelect.selectedCount', { count: selected.length })}
                </span>
                <button
                  type="button"
                  onClick={() => selected.forEach(v => onToggle(v, false))}
                  className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
                >
                  {t('shell.multiSelect.clearAllButton')}
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
  const { t } = useTranslation()
  const optionsByValue = useMemo(() => new Map(options.map(o => [o.value, o])), [options])
  return (
    <ul className="flex flex-wrap gap-1">
      {selected.map((value) => {
        const option = optionsByValue.get(value)
        return (
          <li key={value}>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-2xs text-foreground">
              <span className="max-w-[12rem] truncate font-mono">{option?.label ?? value}</span>
              <button
                type="button"
                onClick={() => onRemove(value)}
                aria-label={t('shell.multiSelect.removeLabel', { label: option?.label ?? value })}
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
  t: TranslateFn,
): string {
  if (selected.length === 0)
    return t('shell.multiSelect.selectPlaceholder', { label })
  if (selected.length === 1) {
    const value = selected[0]!
    const option = options.find(o => o.value === value)
    return option?.label ?? value
  }
  return t('shell.multiSelect.selectedCount', { count: selected.length })
}
