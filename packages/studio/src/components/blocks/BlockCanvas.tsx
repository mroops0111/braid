import type { EmittedBlock } from '@braidhq/schema'
import type { BlockTurn } from '@/lib/blocks/collectBlocks'
import type { RunActivity as Activity } from '@/lib/blocks/runActivity'
import { MessageCircleQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/EmptyState'
import { renderBlock } from './renderBlock'
import { RunActivity } from './RunActivity'

export function blockAnchorId(id: string): string {
  return `block-anchor-${id}`
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

/**
 * Body blocks, with anything sharing a group gathered into one run.
 *
 * The skill says which blocks are readings of the same thing, and this decides
 * what that looks like. Grouping is preserved in arrival order, so a group
 * appears where its first member did rather than jumping to the top.
 */
function groupRuns(blocks: readonly EmittedBlock[]): Array<{ key: string, group: string | null, blocks: EmittedBlock[] }> {
  const runs: Array<{ key: string, group: string | null, blocks: EmittedBlock[] }> = []
  for (const entry of blocks) {
    const group = entry.block.group ?? null
    const open = group === null ? undefined : runs.find(run => run.group === group)
    if (open)
      open.blocks.push(entry)
    else
      runs.push({ key: entry.id, group, blocks: [entry] })
  }
  return runs
}

function Anchored({ entry }: { entry: EmittedBlock }) {
  return (
    <div id={blockAnchorId(entry.id)} className="scroll-mt-6">
      {renderBlock(entry.block)}
    </div>
  )
}

export function BlockCanvas({ turns, running, activity }: {
  turns: readonly BlockTurn[]
  running: boolean
  activity: Activity
}) {
  const { t } = useTranslation()
  const populated = turns.filter(turn => turn.blocks.length > 0)
  const total = populated.reduce((count, turn) => count + turn.blocks.length, 0)

  if (total === 0 && !running) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        <EmptyState
          icon={MessageCircleQuestion}
          title={t('blocks.canvas.emptyTitle')}
          description={t('blocks.canvas.emptyDescription')}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
      <div className="flex flex-col gap-7">
        {running && <RunActivity activity={activity} />}
        {populated.map((turn, index) => (
          <section key={turn.key} className="flex flex-col gap-4">
            {turn.question && index > 0 && (
              <p className="border-t border-border pt-6 text-xs text-muted-foreground">{turn.question}</p>
            )}
            {turn.blocks.filter(entry => slotFor(entry.block) === 'strip').map(entry => (
              <Anchored key={entry.id} entry={entry} />
            ))}
            {groupRuns(turn.blocks.filter(entry => slotFor(entry.block) === 'body')).map(run => (
              run.blocks.length > 1
                ? (
                    // Side by side where the page allows it, stacked where it
                    // does not. The comparison is the skill's claim, the
                    // arrangement is this surface's decision.
                    <div key={run.key} className="grid gap-4 lg:grid-cols-2">
                      {run.blocks.map(entry => <Anchored key={entry.id} entry={entry} />)}
                    </div>
                  )
                : <Anchored key={run.key} entry={run.blocks[0]!} />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
