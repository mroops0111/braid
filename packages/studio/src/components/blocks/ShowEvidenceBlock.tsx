import type { ShowEvidence } from '@braidhq/schema'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EvidenceRefs } from './EvidenceRefs'

/**
 * Reference apparatus, not a peer of the answer.
 * Collapsed by default and set quiet, because it is consulted on demand
 * rather than read straight through.
 */
export function ShowEvidenceBlock({ block }: { block: ShowEvidence }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="border-l border-border pl-3">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex items-center gap-1.5 text-2xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        {open ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
        <span className="uppercase tracking-wider">{block.title ?? t('blocks.evidence.title')}</span>
        <span className="text-muted-foreground/60">{t('blocks.evidence.refCount', { count: block.refs.length })}</span>
      </button>
      {open && <EvidenceRefs refs={block.refs} className="mt-1.5" />}
    </div>
  )
}
