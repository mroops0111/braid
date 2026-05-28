import type { SkillInputDescriptor, SkillInputDynamicOption } from '@braidhq/schema'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Send, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type PickInput = Extract<SkillInputDescriptor, { kind: 'pick' | 'multi-pick' }>
type TextInput = Extract<SkillInputDescriptor, { kind: 'text' }>

interface ActionInputFormProps {
  workspaceId: string
  inputs: readonly SkillInputDescriptor[]
  disabled: boolean
  /**
   * Submit handler. Receives one composed args string per run to fire.
   * Single-value inputs yield a one-element array; a multi-pick with N
   * selected values fans out to N elements so the parent can spawn N
   * parallel skill runs sharing the same per-skill conversation key.
   */
  onSubmit: (composedArgs: readonly string[]) => void
  submitLabel?: string
}

/**
 * Renders a typed form driven by a skill's `braid.inputs` frontmatter
 * declaration. Static-provider picks render inline; dynamic-provider
 * picks (graph-node / source-intent / clarify) fetch options via the
 * server's `/skill-input-options` endpoint and apply the declared
 * `fallback` when the workspace has nothing matching.
 */
export function ActionInputForm({ workspaceId, inputs, disabled, onSubmit, submitLabel = 'Start' }: ActionInputFormProps) {
  const [scalarValues, setScalarValues] = useState<Record<string, string>>(
    () => Object.fromEntries(inputs.filter(i => i.kind !== 'multi-pick').map(input => [input.name, input.default ?? ''])),
  )
  const [multiValues, setMultiValues] = useState<Record<string, readonly string[]>>(
    () => Object.fromEntries(inputs.filter(i => i.kind === 'multi-pick').map(input => [input.name, []])),
  )

  // Required inputs must be filled. Multi-pick required = at least one
  // selected; scalar required = non-empty value.
  const missingRequired = inputs.filter((input) => {
    if (input.optional)
      return false
    if (input.kind === 'multi-pick')
      return (multiValues[input.name]?.length ?? 0) === 0
    return (scalarValues[input.name] ?? '').trim() === ''
  })
  // Refuse > 1 multi-pick per skill: the cartesian product gets too big
  // and the agent transcript becomes unreadable. The validator could
  // enforce this at load time too; this is the runtime backstop.
  const multiPickInputs = inputs.filter(i => i.kind === 'multi-pick')
  const tooManyMultiPicks = multiPickInputs.length > 1
  const canSubmit = !disabled && missingRequired.length === 0 && !tooManyMultiPicks

  function setScalar(name: string, value: string): void {
    setScalarValues(prev => ({ ...prev, [name]: value }))
  }
  function toggleMulti(name: string, value: string, checked: boolean): void {
    setMultiValues((prev) => {
      const current = prev[name] ?? []
      const next = checked ? [...current, value] : current.filter(v => v !== value)
      return { ...prev, [name]: next }
    })
  }

  function handleSubmit(): void {
    if (!canSubmit)
      return
    const multiPick = multiPickInputs[0]
    // Helper to compose one args string from a value-source function.
    function compose(valueFor: (name: string) => string): string {
      return inputs
        .map(input => valueFor(input.name).trim())
        .filter(v => v.length > 0)
        .join(' ')
    }
    if (!multiPick) {
      onSubmit([compose(name => scalarValues[name] ?? '')])
      return
    }
    const selected = multiValues[multiPick.name] ?? []
    if (selected.length === 0) {
      // Optional multi-pick with nothing chosen → one run with the
      // remaining fields, mirroring "leave empty for full pass" intent.
      onSubmit([compose(name => (name === multiPick.name ? '' : scalarValues[name] ?? ''))])
      return
    }
    const batch = selected.map(value =>
      compose(name => (name === multiPick.name ? value : scalarValues[name] ?? '')),
    )
    onSubmit(batch)
  }

  return (
    <div className="space-y-3 border-t border-border px-4 py-3">
      {tooManyMultiPicks && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">
          This skill declares more than one multi-pick input. Only one is supported per skill.
        </div>
      )}
      {inputs.map(input => (
        <InputControl
          key={input.name}
          workspaceId={workspaceId}
          input={input}
          scalarValue={scalarValues[input.name] ?? ''}
          onScalarChange={value => setScalar(input.name, value)}
          multiValue={multiValues[input.name] ?? []}
          onMultiToggle={(value, checked) => toggleMulti(input.name, value, checked)}
          disabled={disabled}
        />
      ))}
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
          <Send />
          {disabled
            ? 'Sending…'
            : multiPickInputs[0] && (multiValues[multiPickInputs[0].name]?.length ?? 0) > 1
              ? `${submitLabel} (${multiValues[multiPickInputs[0].name]!.length} runs)`
              : submitLabel}
        </Button>
      </div>
    </div>
  )
}

interface InputControlSharedProps {
  workspaceId: string
  scalarValue: string
  onScalarChange: (value: string) => void
  multiValue: readonly string[]
  onMultiToggle: (value: string, checked: boolean) => void
  disabled: boolean
}

interface ControlProps<T extends SkillInputDescriptor> extends InputControlSharedProps {
  input: T
}

function InputControl({ input, ...rest }: ControlProps<SkillInputDescriptor>) {
  return (
    <div>
      <label htmlFor={`input-${input.name}`} className="block text-[11px] font-medium text-foreground">
        {input.label}
        {!input.optional && <span className="ml-0.5 text-rose-400">*</span>}
      </label>
      {input.description && <p className="mt-0.5 text-[10px] text-muted-foreground">{input.description}</p>}
      {input.kind === 'text'
        ? <TextField input={input} {...rest} />
        : <PickField input={input} {...rest} />}
    </div>
  )
}

function TextField({ input, scalarValue, onScalarChange, disabled }: ControlProps<TextInput>) {
  if (input.multiline) {
    return (
      <textarea
        id={`input-${input.name}`}
        value={scalarValue}
        onChange={e => onScalarChange(e.target.value)}
        disabled={disabled}
        placeholder={input.placeholder}
        rows={3}
        className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
    )
  }
  return (
    <input
      id={`input-${input.name}`}
      type="text"
      value={scalarValue}
      onChange={e => onScalarChange(e.target.value)}
      disabled={disabled}
      placeholder={input.placeholder}
      className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
    />
  )
}

function PickField({ workspaceId, input, scalarValue, onScalarChange, multiValue, onMultiToggle, disabled }: ControlProps<PickInput>) {
  const isMulti = input.kind === 'multi-pick'
  if (input.provider.type === 'static') {
    if (isMulti) {
      return (
        <MultiSelectDropdown
          input={input}
          options={input.provider.options}
          selected={multiValue}
          onToggle={onMultiToggle}
          disabled={disabled}
        />
      )
    }
    return (
      <SelectControl
        input={input}
        value={scalarValue}
        onChange={onScalarChange}
        disabled={disabled}
        options={input.provider.options}
      />
    )
  }
  return (
    <DynamicPick
      workspaceId={workspaceId}
      input={input}
      scalarValue={scalarValue}
      onScalarChange={onScalarChange}
      multiValue={multiValue}
      onMultiToggle={onMultiToggle}
      disabled={disabled}
    />
  )
}

function MultiSelectDropdown({
  input,
  options,
  selected,
  onToggle,
  disabled,
}: {
  input: PickInput
  options: readonly SkillInputDynamicOption[]
  selected: readonly string[]
  onToggle: (value: string, checked: boolean) => void
  disabled: boolean
}) {
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

  const summary = summariseSelection(selected, options, input)

  return (
    <div className="mt-1 space-y-1.5">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
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
      {selected.length > 1 && (
        <p className="text-[10px] text-muted-foreground">
          Will fire
          {' '}
          {selected.length}
          {' '}
          parallel runs.
        </p>
      )}
    </div>
  )
}

function SelectedChips({
  options,
  selected,
  onRemove,
}: {
  options: readonly SkillInputDynamicOption[]
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
  options: readonly SkillInputDynamicOption[],
  input: PickInput,
): string {
  if (selected.length === 0)
    // Dropdown placeholders are auto-derived from the input label so
    // SKILL.md authors don't have to write redundant `placeholder:`
    // entries for pickers (those were only useful for free-text).
    return `Select ${input.label}…`
  if (selected.length === 1) {
    const value = selected[0]!
    const option = options.find(o => o.value === value)
    return option?.label ?? value
  }
  return `${selected.length} selected`
}

function SelectControl({
  input,
  value,
  onChange,
  disabled,
  options,
}: {
  input: PickInput
  value: string
  onChange: (value: string) => void
  disabled: boolean
  options: readonly SkillInputDynamicOption[]
}) {
  return (
    <select
      id={`input-${input.name}`}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
    >
      {input.optional && <option value="">{input.placeholder ?? `Select ${input.label}…`}</option>}
      {options.map(option => (
        <option key={option.value} value={option.value} title={option.description ?? undefined}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function DynamicPick({ workspaceId, input, scalarValue, onScalarChange, multiValue, onMultiToggle, disabled }: ControlProps<PickInput>) {
  const providerType = input.provider.type
  const filter = 'filter' in input.provider ? input.provider.filter : undefined
  const query = useQuery({
    queryKey: ['skill-input-options', workspaceId, providerType, filter],
    queryFn: () => api.listSkillInputOptions(workspaceId, providerType, filter),
  })

  if (query.isLoading)
    return <div className="mt-1 h-7 animate-pulse rounded-md bg-muted/40" />
  if (query.error) {
    return (
      <div className="mt-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">
        Failed to load options:
        {' '}
        {(query.error as Error).message}
      </div>
    )
  }
  const options = query.data?.items ?? []
  const isMulti = input.kind === 'multi-pick'

  if (options.length === 0) {
    if (input.fallback === 'disabled') {
      return (
        <div className="mt-1 rounded-md border border-input bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          No options available. This skill needs at least one match to run.
        </div>
      )
    }
    // fallback === 'text' (default). Render a free-text field so the
    // user can still drive the skill manually (e.g. a fresh workspace
    // with no graph yet still letting `braid-extract` accept a scope).
    return (
      <input
        id={`input-${input.name}`}
        type="text"
        value={scalarValue}
        onChange={e => onScalarChange(e.target.value)}
        disabled={disabled}
        placeholder={input.placeholder}
        className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
    )
  }

  if (isMulti) {
    return (
      <MultiSelectDropdown
        input={input}
        options={options}
        selected={multiValue}
        onToggle={onMultiToggle}
        disabled={disabled}
      />
    )
  }

  return (
    <SelectControl
      input={input}
      value={scalarValue}
      onChange={onScalarChange}
      disabled={disabled}
      options={options}
    />
  )
}
