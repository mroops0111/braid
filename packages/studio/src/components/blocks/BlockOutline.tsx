import type { EmittedBlock, RenderBlock } from '@braidhq/schema'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { blockAnchorId } from './BlockCanvas'

function fallbackKey(call: RenderBlock['call']):
  | 'blocks.outline.showAnswer'
  | 'blocks.outline.showEvidence'
  | 'blocks.outline.showFinding'
  | 'blocks.outline.showMatrix'
  | 'blocks.outline.showTrace'
  | 'blocks.outline.showDiagram'
  | 'blocks.outline.showSubgraph' {
  switch (call) {
    case 'showAnswer':
      return 'blocks.outline.showAnswer'
    case 'showEvidence':
      return 'blocks.outline.showEvidence'
    case 'showFinding':
      return 'blocks.outline.showFinding'
    case 'showMatrix':
      return 'blocks.outline.showMatrix'
    case 'showTrace':
      return 'blocks.outline.showTrace'
    case 'showDiagram':
      return 'blocks.outline.showDiagram'
    case 'showSubgraph':
      return 'blocks.outline.showSubgraph'
    default: {
      const exhaustive: never = call
      throw new Error(`Unhandled: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** A conflict is the one thing worth spotting from the index alone. */
function toneFor(block: RenderBlock): string {
  if (block.call === 'showFinding' && block.verdict === 'conflict')
    return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

/**
 * The answer's shape at a glance, and the only way to see how many findings a
 * long answer carries without scrolling it. One line per block, because an
 * index is for finding your place rather than for reading.
 */
export function BlockOutline({ blocks }: { blocks: readonly EmittedBlock[] }) {
  const { t } = useTranslation()
  if (blocks.length === 0)
    return null

  const findings = blocks.filter(entry => entry.block.call === 'showFinding')
  const conflicts = findings.filter(entry => entry.block.call === 'showFinding' && entry.block.verdict === 'conflict')

  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto scrollbar-thin border-l border-border px-3 py-4 xl:flex">
      <div>
        <h2 className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('blocks.title')}
        </h2>
        <ul className="space-y-0.5">
          {blocks.map(({ id, block }) => (
            <li key={id}>
              <a
                href={`#${blockAnchorId(id)}`}
                onClick={(event) => {
                  event.preventDefault()
                  document.getElementById(blockAnchorId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className={cn(
                  'block truncate rounded-sm px-1.5 py-1 text-2xs transition-colors duration-150',
                  'hover:bg-accent hover:text-foreground',
                  toneFor(block),
                )}
              >
                {block.title ?? t(fallbackKey(block.call))}
              </a>
            </li>
          ))}
        </ul>
      </div>
      {findings.length > 0 && (
        <div className="border-t border-border pt-3">
          <h2 className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('blocks.outline.consistency')}
          </h2>
          <p className="text-2xs text-muted-foreground">
            {t('blocks.outline.findingSummary', { total: findings.length, conflicts: conflicts.length })}
          </p>
        </div>
      )}
    </aside>
  )
}
