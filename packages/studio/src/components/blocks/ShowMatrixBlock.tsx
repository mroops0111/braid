import type { CellTone, MatrixCell, ShowMatrix } from '@braidhq/schema'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { EvidenceRefs } from './EvidenceRefs'

// Tone carries the reading, the label beside it carries the vocabulary.
// A renderer that switched on the label instead would have to know the ontology.
const TONE_DOT: Record<CellTone, string> = {
  'affirmed': 'bg-emerald-600 dark:bg-emerald-400',
  'denied': 'bg-zinc-500',
  'conditional': 'bg-blue-600 dark:bg-blue-400',
  'conflict': 'bg-amber-600 dark:bg-amber-400',
  'not-applicable': 'bg-transparent border border-border',
}

const TONE_TEXT: Record<CellTone, string> = {
  'affirmed': 'text-foreground/90',
  'denied': 'text-muted-foreground',
  'conditional': 'text-foreground/80',
  'conflict': 'text-amber-600 dark:text-amber-400',
  'not-applicable': 'text-muted-foreground/50',
}

const TONE_ORDER: readonly CellTone[] = ['affirmed', 'denied', 'conditional', 'conflict', 'not-applicable']

const TONE_LABEL_KEY = {
  'affirmed': 'blocks.matrix.tone.affirmed',
  'denied': 'blocks.matrix.tone.denied',
  'conditional': 'blocks.matrix.tone.conditional',
  'conflict': 'blocks.matrix.tone.conflict',
  'not-applicable': 'blocks.matrix.tone.notApplicable',
} as const

/**
 * A dot carries no meaning on its own, so the grid states what its colours mean.
 * Only the tones actually used are listed,
 * because a legend for absent states is noise the reader has to filter.
 */
function ToneLegend({ tones }: { tones: readonly CellTone[] }) {
  const { t } = useTranslation()
  return (
    <ul className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {TONE_ORDER.filter(tone => tones.includes(tone)).map(tone => (
        <li key={tone} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[tone])} />
          {t(TONE_LABEL_KEY[tone])}
        </li>
      ))}
    </ul>
  )
}

export function ShowMatrixBlock({ block }: { block: ShowMatrix }) {
  const { t } = useTranslation()
  const [openCell, setOpenCell] = useState<string | null>(null)
  const usedTones = [...new Set(block.cells.map(cell => cell.tone))]

  const byKey = new Map<string, MatrixCell>()
  for (const cell of block.cells)
    byKey.set(`${cell.row}|${cell.column}`, cell)

  const selected = openCell ? byKey.get(openCell) ?? null : null

  return (
    <figure className="my-1">
      {block.title && (
        <figcaption className="mb-2 text-sm font-semibold text-foreground">{block.title}</figcaption>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-2xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">
                {block.rowAxis.label}
              </th>
              {block.columnAxis.items.map(column => (
                <th key={column.id} className="px-2.5 py-1.5 text-left font-medium text-foreground/80">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rowAxis.items.map(row => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <th className="px-2.5 py-1.5 text-left font-medium text-foreground/80 whitespace-nowrap">
                  {row.label}
                </th>
                {block.columnAxis.items.map((column) => {
                  const key = `${row.id}|${column.id}`
                  const cell = byKey.get(key)
                  if (!cell)
                    return <td key={column.id} className="px-2.5 py-1.5 text-muted-foreground/40">·</td>
                  const hasDetail = cell.refs.length > 0 || cell.note !== undefined
                  return (
                    <td key={column.id} className="px-2.5 py-1.5 align-top">
                      <button
                        type="button"
                        disabled={!hasDetail}
                        onClick={() => setOpenCell(openCell === key ? null : key)}
                        className={cn(
                          'flex items-center gap-1.5 rounded-sm text-left transition-colors duration-150',
                          hasDetail && 'hover:text-foreground',
                          openCell === key && 'text-foreground',
                          TONE_TEXT[cell.tone],
                        )}
                      >
                        <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[cell.tone])} />
                        {cell.state}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="mt-1.5 rounded-md border border-border bg-muted/20 px-2.5 py-2">
          {selected.note && <p className="text-2xs leading-relaxed text-foreground/80">{selected.note}</p>}
          <EvidenceRefs refs={selected.refs} className={selected.note ? 'mt-1.5' : ''} />
        </div>
      )}
      <ToneLegend tones={usedTones} />
      {block.cells.some(cell => cell.refs.length > 0 || cell.note !== undefined) && !selected && (
        <p className="mt-1 text-2xs text-muted-foreground/70">{t('blocks.matrix.cellHint')}</p>
      )}
    </figure>
  )
}
