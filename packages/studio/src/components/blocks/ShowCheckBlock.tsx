import type { ShowCheck } from '@braidhq/schema'
import { Check, HelpCircle, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/components/SkillTranscript/Markdown'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * One question, with its answer held back until the reader commits.
 *
 * The holding back is the whole point.
 * A reader shown the answer beside the question reads both,
 * and learns neither,
 * because recognising an answer feels exactly like having known it.
 *
 * Once they have picked, every choice says what it was,
 * not only the one they took.
 * Marking the pick alone leaves a reader who guessed wrong,
 * knowing they were wrong and not what they should have seen.
 */
export function ShowCheckBlock({ block }: { block: ShowCheck }) {
  const { t } = useTranslation()
  const [picked, setPicked] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)

  const choosing = block.choices.length > 0
  const shown = revealed || picked !== null
  // A document written before a check named its answer cannot be marked,
  // so it reveals without a verdict rather than calling every pick wrong.
  const judged = block.correct !== undefined
  const right = judged && picked === block.correct

  return (
    <section className="rounded-md border border-border bg-card/50 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <HelpCircle className="size-3 text-muted-foreground" />
        <span className="text-2xs uppercase tracking-wider text-muted-foreground">
          {t(`blocks.check.level.${block.level}`)}
        </span>
        {picked !== null && judged && (
          <span className={cn(
            'ml-auto flex items-center gap-1 text-2xs',
            right ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
          )}
          >
            {right ? <Check className="size-3" /> : <X className="size-3" />}
            {t(right ? 'blocks.check.right' : 'blocks.check.wrong')}
          </span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-foreground">{block.prompt}</p>

      {choosing && (
        <ul className="mt-2.5 space-y-1">
          {block.choices.map((choice) => {
            const isCorrect = shown && judged && choice.id === block.correct
            const isMistake = shown && judged && choice.id === picked && !right
            return (
              <li key={choice.id}>
                <button
                  type="button"
                  disabled={picked !== null}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-sm border border-border px-2.5 py-1.5 text-left text-xs transition-colors duration-150',
                    picked === null && 'hover:bg-accent',
                    isCorrect && 'border-emerald-500/40 bg-emerald-500/10',
                    isMistake && 'border-amber-500/40 bg-amber-500/10',
                  )}
                  onClick={() => setPicked(choice.id)}
                >
                  {isCorrect && <Check className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />}
                  {isMistake && <X className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />}
                  <span>{choice.text}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {!choosing && !shown && (
        <Button
          variant="ghost"
          size="xs"
          className="mt-2.5 [&_svg]:size-3"
          onClick={() => setRevealed(true)}
        >
          <Check />
          {t('blocks.check.reveal')}
        </Button>
      )}

      {shown && (
        <div className="mt-2.5 border-t border-border pt-2.5 text-xs leading-relaxed text-foreground/90">
          <Markdown text={block.answer} />
        </div>
      )}
    </section>
  )
}
