import type { SkillInputDescriptor, SkillInputDynamicOption, SourceId, SourceUnit, SourceUnitState } from '@braidhq/schema'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MultiSelectDropdown } from '@/components/MultiSelectDropdown'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

type PickInput = Extract<SkillInputDescriptor, { kind: 'pick' | 'multi-pick' }>
type TextInput = Extract<SkillInputDescriptor, { kind: 'text' }>

export interface SkillRunSpec {
  readonly args: string
  /**
   * Set when the run's value originated from a `source-intent` picker.
   * Plumbing it through lets the server record an observation against
   * the unit on successful completion (issue #31). Other run kinds
   * leave it undefined.
   */
  readonly sourceUnit?: {
    readonly sourceId: SourceId
    readonly path: string
  }
}

interface ActionInputFormProps {
  workspaceId: string
  inputs: readonly SkillInputDescriptor[]
  disabled: boolean
  /**
   * Submit handler. Receives one run spec per run to fire. A single-value
   * form yields a one-element array; a multi-pick with N selected values
   * fans out to N elements so the parent can spawn N parallel skill runs
   * sharing the same per-skill conversation key. When the input came
   * from a `source-intent` picker the spec carries `sourceUnit`.
   */
  onSubmit: (runs: readonly SkillRunSpec[]) => void
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
  const queryClient = useQueryClient()
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
    function compose(valueFor: (name: string) => string): string {
      return inputs
        .map(input => valueFor(input.name).trim())
        .filter(v => v.length > 0)
        .join(' ')
    }

    function sourceUnitFor(input: PickInput | undefined, value: string) {
      if (!input || input.provider.type !== 'source-intent' || !value)
        return undefined
      const filter = 'filter' in input.provider ? input.provider.filter : undefined
      const cached = queryClient.getQueryData<{ items: SkillInputDynamicOption[] }>(
        ['skill-input-options', workspaceId, input.provider.type, filter],
      )
      const option = cached?.items.find(item => item.value === value)
      if (!option?.sourceId)
        return undefined
      return { sourceId: option.sourceId, path: value }
    }

    if (!multiPick) {
      const args = compose(name => scalarValues[name] ?? '')
      const sourcePick = inputs.find(
        (i): i is PickInput => i.kind === 'pick' && i.provider.type === 'source-intent',
      )
      const sourceUnit = sourcePick ? sourceUnitFor(sourcePick, scalarValues[sourcePick.name] ?? '') : undefined
      onSubmit([{ args, ...(sourceUnit ? { sourceUnit } : {}) }])
      return
    }
    const selected = multiValues[multiPick.name] ?? []
    if (selected.length === 0) {
      // Optional multi-pick with nothing chosen → one run with the
      // remaining fields, mirroring "leave empty for full pass" intent.
      onSubmit([{ args: compose(name => (name === multiPick.name ? '' : scalarValues[name] ?? '')) }])
      return
    }
    const runs = selected.map((value): SkillRunSpec => {
      const args = compose(name => (name === multiPick.name ? value : scalarValues[name] ?? ''))
      const sourceUnit = sourceUnitFor(multiPick, value)
      return { args, ...(sourceUnit ? { sourceUnit } : {}) }
    })
    onSubmit(runs)
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
        <MultiPickField input={input} options={input.provider.options} selected={multiValue} onToggle={onMultiToggle} disabled={disabled} />
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

/**
 * Decorate source-intent picker options with per-unit freshness
 * badges. For each distinct sourceId carried by the options:
 *   - "fresh" badge when the on-disk sha matches the recorded
 *     `lastObservedSha` (option appears in `diff.unchanged`)
 *   - "stale" badge when the recorded sha differs (option appears in
 *     `diff.changed`)
 *   - no badge when the unit has never been observed (option appears
 *     in `diff.new`)
 *
 * Returns the input options unchanged for any provider other than
 * `source-intent`. The hook is always called with stable order so it
 * is safe under the rules of hooks even when `rawOptions` is empty
 * (loading / error pre-resolution).
 */
function useSourceIntentBadges(
  workspaceId: string,
  providerType: string,
  rawOptions: readonly SkillInputDynamicOption[],
): readonly DynamicOptionWithBadge[] {
  const isSourceIntent = providerType === 'source-intent'
  const sourceIds = useMemo(() => {
    if (!isSourceIntent)
      return [] as readonly string[]
    const set = new Set<string>()
    for (const opt of rawOptions) {
      if (opt.sourceId)
        set.add(opt.sourceId as string)
    }
    return [...set].sort()
  }, [isSourceIntent, rawOptions])

  const diffQueries = useQueries({
    queries: sourceIds.map(sourceId => ({
      queryKey: ['source-unit-diff', workspaceId, sourceId] as const,
      queryFn: () => api.getSourceUnitDiff(workspaceId, sourceId),
    })),
  })
  const ledgerQueries = useQueries({
    queries: sourceIds.map(sourceId => ({
      queryKey: ['source-unit-states', workspaceId, sourceId] as const,
      queryFn: () => api.listSourceUnitStates(workspaceId, sourceId),
    })),
  })

  return useMemo(() => {
    if (!isSourceIntent)
      return rawOptions as readonly DynamicOptionWithBadge[]
    interface Lookup {
      readonly fresh: Set<string>
      readonly stale: Set<string>
      readonly observedAt: Map<string, string>
    }
    const perSource = new Map<string, Lookup>()
    sourceIds.forEach((sourceId, index) => {
      const diff = diffQueries[index]?.data
      const ledger = ledgerQueries[index]?.data
      if (!diff || !ledger)
        return
      const fresh = new Set(diff.unchanged.map((u: SourceUnit) => u.path))
      const stale = new Set(diff.changed.map((u: SourceUnit) => u.path))
      const observedAt = new Map<string, string>()
      for (const state of ledger.items as SourceUnitState[])
        observedAt.set(state.path, state.lastObservedAt)
      perSource.set(sourceId, { fresh, stale, observedAt })
    })
    const now = Date.now()
    return rawOptions.map((opt) => {
      const sourceId = opt.sourceId as string | undefined
      if (!sourceId)
        return opt
      const lookup = perSource.get(sourceId)
      if (!lookup)
        return opt
      const lastAt = lookup.observedAt.get(opt.value)
      if (lookup.fresh.has(opt.value) && lastAt) {
        return {
          ...opt,
          badge: {
            text: relativeAgo(now, lastAt),
            tone: 'fresh' as const,
            title: `Last extracted ${new Date(lastAt).toLocaleString()}`,
          },
        }
      }
      if (lookup.stale.has(opt.value)) {
        return {
          ...opt,
          badge: {
            text: 'stale',
            tone: 'stale' as const,
            title: lastAt
              ? `Changed since last extract ${new Date(lastAt).toLocaleString()}`
              : 'Changed since last extract',
          },
        }
      }
      return opt
    })
  }, [isSourceIntent, rawOptions, sourceIds, diffQueries, ledgerQueries])
}

interface DynamicOptionWithBadge extends SkillInputDynamicOption {
  badge?: {
    readonly text: string
    readonly tone?: 'fresh' | 'stale'
    readonly title?: string
  }
}

/**
 * Compact "Nm ago" / "Nh ago" / "Nd ago" formatter for the freshness
 * chip. Avoids pulling in a date library for one badge.
 */
function relativeAgo(now: number, iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then))
    return 'recent'
  const delta = Math.max(0, now - then)
  const m = Math.floor(delta / 60_000)
  if (m < 1)
    return 'just now'
  if (m < 60)
    return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)
    return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
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
  const rawOptions = query.data?.items ?? []
  // Hook is always called (even with []) so the rules-of-hooks order
  // stays stable across the loading / error early returns below.
  const options = useSourceIntentBadges(workspaceId, providerType, rawOptions)
  const isMulti = input.kind === 'multi-pick'

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
      <MultiPickField input={input} options={options} selected={multiValue} onToggle={onMultiToggle} disabled={disabled} />
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

/**
 * Form-context wrapper around the generic dropdown. Adds the
 * batch-run hint when multiple values are selected — that's
 * Actions-form specific, not part of the dropdown's contract.
 */
function MultiPickField({
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
  return (
    <div className="mt-1 space-y-1">
      <MultiSelectDropdown
        id={`input-${input.name}`}
        label={input.label}
        options={options}
        selected={selected}
        onToggle={onToggle}
        disabled={disabled}
      />
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
