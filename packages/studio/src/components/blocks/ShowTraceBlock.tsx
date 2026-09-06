import type { ShowTrace } from '@braidhq/schema'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReferenceTag } from '@/components/references/ReferenceTag'
import { cn } from '@/lib/utils'
import { EvidenceRefs } from './EvidenceRefs'

function Count({ value, label }: { value: number, label: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-mono text-2xs font-medium text-foreground">{value}</span>
      <span className="text-2xs text-muted-foreground">{label}</span>
    </span>
  )
}

/**
 * The reading trail, collapsed to its counts.
 * What a run declined to use is the one thing a reader cannot infer
 * from the answer, so `skipped` is surfaced rather than buried.
 */
export function ShowTraceBlock({ block }: { block: ShowTrace }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const hits = block.searched.reduce((total, search) => total + search.hits, 0)
  const hasDetail = block.searched.length > 0 || block.read.length > 0 || block.skipped.length > 0

  return (
    <div className={cn('border border-border px-3 py-1.5', open ? 'rounded-md' : 'rounded-full')}>
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen(value => !value)}
        className={cn(
          'flex w-full items-center gap-3 text-left transition-colors duration-150',
          hasDetail && 'hover:text-foreground',
        )}
      >
        {hasDetail && (open
          ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />)}
        <Count value={block.searched.length} label={t('blocks.trace.searches')} />
        <Count value={hits} label={t('blocks.trace.hits')} />
        <Count value={block.read.length} label={t('blocks.trace.read')} />
        <Count value={block.cited.length} label={t('blocks.trace.cited')} />
        {block.skipped.length > 0 && (
          <span className="text-2xs text-amber-400">
            {t('blocks.trace.skipped', { count: block.skipped.length })}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2.5 space-y-3 border-t border-border pt-2.5">
          {block.searched.length > 0 && (
            <div>
              <h4 className="mb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('blocks.trace.searchedHeading')}
              </h4>
              <ul className="space-y-0.5">
                {block.searched.map((search, index) => (
                  <li key={index} className="flex items-baseline justify-between gap-2 text-2xs">
                    <span className="font-mono text-muted-foreground">{search.query}</span>
                    <span className="shrink-0 text-muted-foreground/70">
                      {t('blocks.trace.hitCount', { count: search.hits })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {block.cited.length > 0 && (
            <div>
              <h4 className="mb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('blocks.trace.citedHeading')}
              </h4>
              <div className="flex flex-wrap gap-1">
                {block.cited.map(nodeId => (
                  <ReferenceTag key={nodeId} reference={{ kind: 'node' as never, id: nodeId }} className="text-2xs" />
                ))}
              </div>
            </div>
          )}

          {block.read.length > 0 && (
            <div>
              <h4 className="mb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('blocks.trace.readHeading')}
              </h4>
              <EvidenceRefs refs={block.read} />
            </div>
          )}

          {block.skipped.length > 0 && (
            <div>
              <h4 className="mb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('blocks.trace.skippedHeading')}
              </h4>
              <ul className="space-y-1">
                {block.skipped.map((skip, index) => (
                  <li key={index}>
                    <EvidenceRefs refs={[skip.ref]} />
                    <p className="ml-4 text-2xs text-muted-foreground/70">{skip.why}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
