import type { ShowCustom } from '@braidhq/schema'
import { PackageOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * A shape this surface does not know, named rather than drawn.
 *
 * A plugin may ship a block only its own application understands,
 * so the honest answer here is to say which kind arrived and stop.
 * Guessing at a rendering shows a reader something the plugin never meant,
 * and dropping it silently hides part of the document.
 */
export function ShowCustomBlock({ block }: { block: ShowCustom }) {
  const { t } = useTranslation()
  return (
    <section className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5">
      <PackageOpen className="size-3 shrink-0 text-muted-foreground" />
      <p className="text-2xs text-muted-foreground">
        {t('blocks.custom.notDrawn')}
        {' '}
        <span className="font-mono text-foreground/70">{block.kind}</span>
      </p>
    </section>
  )
}
