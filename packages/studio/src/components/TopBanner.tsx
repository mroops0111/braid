import type { ComponentType, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TopBannerTone = 'reactor' | 'run' | 'batch' | 'warning'

interface TopBannerProps {
  /** Visual / colour palette. Each tone matches one of the three live surfaces. */
  tone: TopBannerTone
  /** Bold prefix label, e.g. "Reactor" / "Batch" / `/braid-extract`. */
  label: string
  /** Description text rendered next to the label in `text-muted-foreground`. */
  detail: ReactNode
  /** Optional icon override; defaults to a spinner appropriate for the tone. */
  icon?: ComponentType<{ className?: string }>
  /** Opt out of the spin animation for non-spinning icons (e.g. CheckCircle2). Defaults true. */
  spin?: boolean
  /** Right-aligned action slot, e.g. Cancel button or link. */
  actions?: ReactNode
}

/**
 * Single source of truth for the top-of-app status banner. Reactor /
 * Batch / InFlightRun banners all funnel through this so the three
 * never disagree on height, padding, or typography when they stack
 * during a busy session.
 */
export function TopBanner({ tone, label, detail, icon: Icon, spin = true, actions }: TopBannerProps): ReactNode {
  const ResolvedIcon = Icon ?? Loader2
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b px-4 py-1.5 text-xs',
        tone === 'reactor' && 'border-emerald-500/30 bg-emerald-500/5',
        tone === 'run' && 'border-primary/30 bg-primary/5',
        tone === 'batch' && 'border-sky-500/30 bg-sky-500/5',
        tone === 'warning' && 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      <ResolvedIcon
        className={cn(
          'size-3',
          spin && (tone === 'reactor' || tone === 'run' || tone === 'batch') && 'animate-spin',
          tone === 'reactor' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'run' && 'text-primary',
          tone === 'batch' && 'text-sky-600 dark:text-sky-400',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
        )}
      />
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-muted-foreground">{detail}</span>
      {actions && <div className="ml-auto">{actions}</div>}
    </div>
  )
}
