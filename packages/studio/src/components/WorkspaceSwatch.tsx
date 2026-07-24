import { usePendingClarification, usePendingProposals, useRuns } from '@/lib/queries'
import { cn } from '@/lib/utils'

// Muted tint palette, a low-saturation background with accented foreground,
// so multiple swatches stacked in the sidebar do not compete for attention.
// Identification comes from the monogram letters first,
// colour only as a secondary cue.
// Tailwind needs each class as a static literal,
// to make it into the final CSS bundle.
const SWATCH_PALETTE = [
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
] as const

function monogramLetters(id: string): string {
  const parts = id.split(/[-_\s.]+/).filter(Boolean)
  if (parts.length >= 2)
    return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase()
  return id.slice(0, 2).toUpperCase()
}

function colorClass(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++)
    h = (h * 31 + id.charCodeAt(i)) >>> 0
  return SWATCH_PALETTE[h % SWATCH_PALETTE.length]!
}

interface WorkspaceSwatchProps {
  workspaceId: string
  size?: 'sm' | 'md'
  active?: boolean
  pendingDot?: boolean
}

export function WorkspaceSwatch({ workspaceId, size = 'md', active, pendingDot }: WorkspaceSwatchProps) {
  const letters = monogramLetters(workspaceId)
  const color = colorClass(workspaceId)
  const dims = size === 'md' ? 'size-7 text-2xs' : 'size-5 text-2xs'
  return (
    <div className={cn('relative shrink-0', size === 'md' ? 'size-7' : 'size-5')}>
      <div
        className={cn(
          'flex h-full w-full items-center justify-center rounded-md font-semibold',
          dims,
          color,
          active && 'ring-2 ring-sidebar-foreground/60 ring-offset-1 ring-offset-sidebar',
        )}
      >
        {letters}
      </div>
      {pendingDot && (
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
      )}
    </div>
  )
}

/**
 * Variant that drives `pendingDot` from the workspace's queue counts,
 * so the collapsed sidebar can hint "something needs attention",
 * without rendering the numeric badges that only fit when expanded.
 */
export function WorkspaceSwatchWithPending({ workspaceId, size = 'md', active = false }: {
  workspaceId: string
  size?: 'sm' | 'md'
  active?: boolean
}) {
  const { data: proposals } = usePendingProposals(workspaceId)
  const { data: clarifications } = usePendingClarification(workspaceId)
  const { data: runs } = useRuns(workspaceId)
  const hasPending
    = (proposals?.items.length ?? 0) > 0
      || (clarifications?.items.length ?? 0) > 0
      || (runs?.items.some(r => !r.completedAt) ?? false)
  return <WorkspaceSwatch workspaceId={workspaceId} size={size} active={active} pendingDot={hasPending} />
}
