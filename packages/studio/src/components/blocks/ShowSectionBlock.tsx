import type { SectionLevel, ShowSection } from '@braidhq/schema'
import { cn } from '@/lib/utils'

const HEADING: Record<SectionLevel, string> = {
  1: 'text-base font-semibold tracking-tight',
  2: 'text-sm font-semibold',
  3: 'text-xs font-semibold text-muted-foreground',
}

/**
 * Where one part of a document starts.
 *
 * A rule above it at the top level, and none deeper,
 * so a reader scanning for the next part finds it,
 * without every heading shouting equally.
 * The nodes it covers are not drawn here,
 * because the block after it usually draws them properly,
 * and a list of ids under a heading is machinery nobody asked to see.
 */
export function ShowSectionBlock({ block }: { block: ShowSection }) {
  return (
    <header className={cn('mt-2', block.level === 1 && 'mt-6 border-t border-border pt-5 first:mt-0 first:border-0 first:pt-0')}>
      <h2 className={cn(HEADING[block.level], 'text-foreground')}>{block.heading}</h2>
    </header>
  )
}
