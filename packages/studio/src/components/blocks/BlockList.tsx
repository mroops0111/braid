import type { EmittedBlock } from '@braidhq/schema'
import { useTranslation } from 'react-i18next'
import { renderBlock } from './renderBlock'

/**
 * The run's rendered output, above the transcript that produced it.
 * A run that renders nothing shows nothing here,
 * so a skill adopting the protocol is the only thing that changes the view.
 */
export function BlockList({ blocks }: { blocks: readonly EmittedBlock[] }) {
  const { t } = useTranslation()
  if (blocks.length === 0)
    return null
  return (
    <div className="max-h-[55%] shrink-0 overflow-y-auto scrollbar-thin border-b border-border px-4 py-3">
      <h2 className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
        {t('blocks.title')}
      </h2>
      <div className="space-y-2.5">
        {blocks.map(({ id, block }) => (
          <div key={id} className="rounded-md border border-border bg-card px-3 py-2.5">
            {renderBlock(block)}
          </div>
        ))}
      </div>
    </div>
  )
}
