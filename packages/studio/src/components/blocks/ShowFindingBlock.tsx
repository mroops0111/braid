import type { ShowFinding } from '@braidhq/schema'
import { useTranslation } from 'react-i18next'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { EvidenceRefs } from './EvidenceRefs'

// A finding interrupts the answer's confidence, so its rule carries the verdict
// and the surface it sits on stays close to the page.
const VERDICT_RULE: Record<ShowFinding['verdict'], string> = {
  consistent: 'border-l-emerald-500/60 bg-emerald-500/[0.04]',
  conflict: 'border-l-amber-500/70 bg-amber-500/[0.05]',
  unverifiable: 'border-l-zinc-500/60 bg-zinc-500/[0.04]',
}

/**
 * An annotation on the answer, not a peer of it.
 * Reads as a callout inserted into the reading column, which is what a
 * disagreement between two sources actually is.
 */
export function ShowFindingBlock({ block }: { block: ShowFinding }) {
  const { t } = useTranslation()
  return (
    <aside className={cn('rounded-r-md border-l-2 py-2.5 pl-3 pr-3', VERDICT_RULE[block.verdict])}>
      <div className="flex items-baseline gap-2">
        <StatusBadge status={block.verdict} className="shrink-0" />
        <p className="flex-1 text-xs leading-relaxed text-foreground">{block.statement}</p>
      </div>

      <ol className="mt-2 space-y-1.5">
        {block.sides.map((side, index) => (
          <li key={index} className="flex gap-2">
            <span className="mt-0.5 shrink-0 font-mono text-2xs text-muted-foreground/60">
              {String.fromCodePoint(65 + index)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-foreground/85">{side.summary}</p>
              <EvidenceRefs refs={side.refs} className="mt-1" />
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-2 flex items-center gap-2 text-2xs text-muted-foreground/70">
        <span>{t('blocks.finding.confidence', { value: Math.round(block.confidence * 100) })}</span>
        {block.registered
          ? (
              <Badge variant="outline" className="text-2xs uppercase">
                {t('blocks.finding.registered')}
              </Badge>
            )
          : (
              <span>{t('blocks.finding.unregistered')}</span>
            )}
      </div>

      {block.suggestedSource && (
        <p className="mt-1.5 text-2xs text-muted-foreground">
          {t('blocks.finding.suggestedSource', { source: block.suggestedSource })}
        </p>
      )}
    </aside>
  )
}
