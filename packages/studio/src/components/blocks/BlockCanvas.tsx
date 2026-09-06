import type { EmittedBlock } from '@braidhq/schema'
import { MessageCircleQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { renderBlock } from './renderBlock'

export function blockAnchorId(id: string): string {
  return `block-anchor-${id}`
}

/** Blocks that arrived under one question, in the order the run emitted them. */
export interface AnswerTurn {
  readonly key: string
  readonly question: string | null
  readonly blocks: readonly EmittedBlock[]
}

/**
 * Where a block sits, decided by what kind of block it is.
 *
 * A block carries no layout of its own, so this is the one place that turns an
 * ordered sequence into a page. A trail belongs above what it produced, and
 * everything else reads in order at the width of the column. Findings stay in
 * the flow rather than in a rail, because two sides plus their evidence is
 * wide content that a narrow column turns into a wall of wrapped lines.
 */
type Slot = 'strip' | 'body'

function slotFor(block: EmittedBlock['block']): Slot {
  return block.call === 'showTrace' ? 'strip' : 'body'
}

function Anchored({ entry }: { entry: EmittedBlock }) {
  return (
    <div id={blockAnchorId(entry.id)} className="scroll-mt-6">
      {renderBlock(entry.block)}
    </div>
  )
}

export function BlockCanvas({ turns, running }: { turns: readonly AnswerTurn[], running: boolean }) {
  const { t } = useTranslation()
  const populated = turns.filter(turn => turn.blocks.length > 0)
  const total = populated.reduce((count, turn) => count + turn.blocks.length, 0)

  if (total === 0) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        <EmptyState
          icon={MessageCircleQuestion}
          title={running ? t('blocks.canvas.workingTitle') : t('blocks.canvas.emptyTitle')}
          description={running ? t('blocks.canvas.workingDescription') : t('blocks.canvas.emptyDescription')}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
      <div className="flex flex-col gap-7">
        {populated.map((turn, index) => (
          <section key={turn.key} className="flex flex-col gap-4">
            {turn.question && index > 0 && (
              <p className="border-t border-border pt-6 text-xs text-muted-foreground">{turn.question}</p>
            )}
            {turn.blocks.filter(entry => slotFor(entry.block) === 'strip').map(entry => (
              <Anchored key={entry.id} entry={entry} />
            ))}
            {turn.blocks.filter(entry => slotFor(entry.block) === 'body').map(entry => (
              <Anchored key={entry.id} entry={entry} />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
