import type { Reference, ReferenceKind } from '@braidhq/schema'
import type { ReactNode } from 'react'
import type { ResolvedReference } from '@/lib/references/ReferenceResolver'
import { X } from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NODE_DETAIL_ASIDE_WIDTH } from '@/components/graph/styleTokens'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useReferenceRegistry } from '@/lib/references/ReferenceRegistryContext'

export interface ReferencePeek {
  readonly open: (reference: Reference) => void
  readonly close: () => void
}

const ReferencePeekContext = createContext<ReferencePeek | null>(null)

/** Null outside a provider, which makes a tag fall back to plain navigation. */
export function useReferencePeek(): ReferencePeek | null {
  return useContext(ReferencePeekContext)
}

const PeekTargetContext = createContext<Reference | null>(null)

/**
 * Reads a reference in place, beside whatever surface the reader is on.
 *
 * Clicking a tag mid-review should not cost the reader their scroll position,
 * their selected candidate, or the proposal they had open. So the click peeks,
 * and leaving for the target's own surface is a separate, explicit button.
 *
 * Holds the target only. The panel renders through {@link ReferencePeekAside},
 * which the shell places as a flex sibling, matching the graph's detail panel.
 * A modal sheet would cover the very text the reader clicked from.
 */
export function ReferencePeekProvider({ resetKey, children }: { resetKey: string, children: ReactNode }) {
  const [reference, setReference] = useState<Reference | null>(null)
  const peek = useMemo<ReferencePeek>(
    () => ({ open: setReference, close: () => setReference(null) }),
    [],
  )
  // A peek reads one reference beside the surface it was opened from, so it
  // does not survive a move to another surface. Left open it would sit next to
  // that surface's own detail panel, showing the same component twice.
  useEffect(() => {
    setReference(null)
  }, [resetKey])
  return (
    <ReferencePeekContext.Provider value={peek}>
      <PeekTargetContext.Provider value={reference}>
        {children}
      </PeekTargetContext.Provider>
    </ReferencePeekContext.Provider>
  )
}

/**
 * Lets a surface that already shows one kind's detail claim that kind, so a
 * click swaps the panel it has rather than opening a second, identical one
 * beside it. Every other kind falls through to the app-level peek.
 */
export function ReferencePeekOverride({ kind, onOpen, children }: {
  kind: ReferenceKind
  onOpen: (id: string) => void
  children: ReactNode
}) {
  const outer = useReferencePeek()
  const value = useMemo<ReferencePeek>(() => ({
    open: (reference) => {
      if (reference.kind === kind)
        onOpen(reference.id)
      else
        outer?.open(reference)
    },
    close: () => outer?.close(),
  }), [kind, onOpen, outer])
  return <ReferencePeekContext.Provider value={value}>{children}</ReferencePeekContext.Provider>
}

/**
 * The peek panel itself, an in-flow aside that narrows the page rather than
 * covering it. Renders nothing while no reference is open.
 */
export function ReferencePeekAside() {
  const { t } = useTranslation()
  const registry = useReferenceRegistry()
  const peek = useReferencePeek()
  const reference = useContext(PeekTargetContext)
  const close = peek?.close

  // The modal sheet gave Escape for free. An in-flow aside has to bind it,
  // and the listener only exists while a reference is open.
  useEffect(() => {
    if (!reference || !close)
      return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape')
        close?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [reference, close])

  if (!reference)
    return null

  const resolved = registry?.resolve(reference) ?? null
  const detail = registry?.renderDetail(reference) ?? null

  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden border-l border-border bg-card duration-150 animate-in slide-in-from-right-4"
      style={{ width: NODE_DETAIL_ASIDE_WIDTH }}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        {detail ?? <UnknownReferenceBody reference={reference} resolved={resolved} onClose={() => peek?.close()} />}
      </div>
      {resolved?.open && (
        <div className="border-t border-border p-3">
          <Button
            variant="outline"
            size="sm"
            // Icon just under the label, 12px against 14px. Same ratio the
            // hover card's own open action uses, and below the button
            // default's 16-against-14 which reads as an oversized glyph.
            className="w-full justify-center [&_svg]:size-3"
            onClick={() => {
              resolved.open?.()
              peek?.close()
            }}
          >
            {resolved.openIcon}
            {resolved.openLabel ?? t('references.openFallback')}
          </Button>
        </div>
      )}
    </aside>
  )
}

/**
 * Shown for a kind with no detail body of its own, and for an id nothing claims.
 * Repeats what the hover card already knows rather than showing an empty panel.
 */
function UnknownReferenceBody({ reference, resolved, onClose }: {
  reference: Reference | null
  resolved: ResolvedReference | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  if (!reference)
    return null
  return (
    <div className="relative space-y-2 p-4">
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
      <Badge variant="outline" className="text-2xs uppercase tracking-wider text-muted-foreground">
        {reference.kind}
      </Badge>
      <h2 className="text-sm font-semibold text-foreground">
        {resolved?.title ?? t('references.peek.missingTitle')}
      </h2>
      <p className="font-mono text-2xs text-muted-foreground">{reference.id}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {resolved?.description ?? t('references.peek.missingDescription', { id: reference.id })}
      </p>
    </div>
  )
}
