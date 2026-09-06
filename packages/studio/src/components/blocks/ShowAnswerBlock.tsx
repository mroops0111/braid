import type { ShowAnswer } from '@braidhq/schema'
import { Markdown } from '@/components/SkillTranscript/Markdown'

/**
 * The conclusion, and therefore the document itself.
 * No card, no border, no tinted surface. A frame around the answer would
 * make it read as one widget among several rather than as the thing asked for.
 */
export function ShowAnswerBlock({ block }: { block: ShowAnswer }) {
  return (
    <section className="text-xs leading-relaxed text-foreground/90">
      {block.title && (
        <h2 className="mb-1.5 text-base font-semibold tracking-tight text-foreground">{block.title}</h2>
      )}
      <Markdown text={block.markdown} />
    </section>
  )
}
