import type { NodeId, Reference } from '@braidhq/schema'
import type { ResolvedReference } from '@/lib/references/ReferenceResolver'
import { NODE_REFERENCE_KIND } from '@braidhq/schema'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useReferenceRegistry } from '@/lib/references/ReferenceRegistryContext'
import { cn } from '@/lib/utils'
import { useReferencePeek } from './ReferencePeek'

interface ReferenceTagProps {
  reference: Reference
  className?: string
}

const BASE_TOKEN_CLASS = 'rounded-sm px-1 py-px font-mono transition-colors'

/**
 * Renders one reference as a highlighted token with a hover card.
 * Kind-agnostic by design, everything it shows comes from the registry,
 * so a new kind needs no change here.
 */
export function ReferenceTag({ reference, className }: ReferenceTagProps) {
  const { t } = useTranslation()
  const registry = useReferenceRegistry()
  const peek = useReferencePeek()
  // Controlled, so acting on the tag dismisses the card.
  // Acting leaves the pointer sitting on the trigger, which would reopen the
  // card over whatever just opened, so reopening is suppressed until the
  // pointer actually leaves.
  const [cardOpen, setCardOpen] = useState(false)
  const suppressCardRef = useRef(false)
  const resolved = registry?.resolve(reference) ?? null

  function changeCardOpen(next: boolean): void {
    if (next && suppressCardRef.current)
      return
    setCardOpen(next)
  }

  function dismissCard(): void {
    suppressCardRef.current = true
    setCardOpen(false)
  }

  if (!resolved) {
    return (
      <span
        className={cn(BASE_TOKEN_CLASS, 'bg-muted/60 text-muted-foreground underline decoration-dotted underline-offset-2', className)}
        title={t('references.unknownTooltip', { kind: reference.kind })}
      >
        {reference.id}
      </span>
    )
  }

  // Clicking peeks, which keeps the reader where they were.
  // Without a peek context the tag falls back to navigating.
  const target = peek ? () => peek.open(reference) : resolved.open
  const activate = target
    ? () => {
        dismissCard()
        target()
      }
    : undefined
  const tokenClass = cn(
    BASE_TOKEN_CLASS,
    'bg-primary/10 text-primary/90 hover:bg-primary/20',
    activate && 'cursor-pointer',
    className,
  )

  return (
    <HoverCard open={cardOpen} onOpenChange={changeCardOpen} openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        {activate
          ? (
              <button
                type="button"
                onClick={activate}
                onPointerLeave={() => { suppressCardRef.current = false }}
                className={tokenClass}
              >
                {reference.id}
              </button>
            )
          : (
              <span className={tokenClass}>{reference.id}</span>
            )}
      </HoverCardTrigger>
      <HoverCardContent align="start" side="top" className="w-72 space-y-1.5 p-3">
        <ReferenceCard resolved={resolved} onOpen={dismissCard} />
      </HoverCardContent>
    </HoverCard>
  )
}

/** Shorthand for the many surfaces that already hold a typed `NodeId` field. */
export function NodeReferenceTag({ nodeId, className }: { nodeId: NodeId, className?: string }) {
  const reference = useMemo(() => ({ kind: NODE_REFERENCE_KIND, id: nodeId }), [nodeId])
  return <ReferenceTag reference={reference} {...(className ? { className } : {})} />
}

function ReferenceCard({ resolved, onOpen }: { resolved: ResolvedReference, onOpen: () => void }) {
  return (
    <>
      {resolved.badge && (
        <Badge variant="outline" className="text-2xs uppercase tracking-wider text-muted-foreground">
          {resolved.badge}
        </Badge>
      )}
      <p className="text-sm font-medium text-foreground">{resolved.title}</p>
      {resolved.description && (
        <p className="line-clamp-4 text-xs leading-relaxed text-muted-foreground">{resolved.description}</p>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-1.5">
        <span className="truncate font-mono text-2xs text-muted-foreground">{resolved.reference.id}</span>
        {resolved.open && (
          // Leaving the current surface stays an explicit action, never a stray click.
          // Icon just under the label, 10px against 11px. Same ratio the peek
          // panel's open action uses, and below the button default's 12px
          // which reads as an oversized glyph on a row this small.
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-2xs [&_svg]:size-2.5"
            onClick={() => {
              onOpen()
              resolved.open?.()
            }}
          >
            {resolved.openIcon}
            {resolved.openLabel}
          </Button>
        )}
      </div>
    </>
  )
}
