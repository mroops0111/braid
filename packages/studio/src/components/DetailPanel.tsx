import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * The right-hand pane, wherever one thing is being read in full.
 *
 * A node and a source document are different subjects, but a reader arrives at
 * both the same way and expects the same shape: what it is, then its name, then
 * its identifier, then sections. Two panes built separately drifted into two
 * headers, two paddings, and two heading styles, so the chrome lives here and
 * the subjects supply only their own content.
 */
export function DetailPanel({ badges, title, subtitle, actions, onClose, children }: {
  /** Type, status, and anything else that says what kind of thing this is. */
  badges?: ReactNode
  title: string
  /** The machine-facing identifier, set in mono beneath the name. */
  subtitle?: ReactNode
  /** Anything the reader can do to it, directly under the heading. */
  actions?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="relative space-y-1.5 border-b border-border p-4">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('graph.detail.closeDetailButton')}
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
        {badges && <div className="flex flex-wrap items-center gap-1.5 pr-8">{badges}</div>}
        <h2 className="pr-8 text-sm font-semibold leading-snug text-foreground">{title}</h2>
        {subtitle && <p className="break-all font-mono text-2xs text-muted-foreground">{subtitle}</p>}
        {actions && <div className="pt-1">{actions}</div>}
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 scrollbar-thin">
        {children}
      </div>
    </div>
  )
}

/** The small caps heading every section in a detail pane takes. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
  )
}

/** A label and its value, for the facts a subject states about itself. */
export function DetailFact({ label, value }: { label: string, value: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-2xs">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-foreground">{value}</span>
    </div>
  )
}
