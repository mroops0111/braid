import type { ShowDiagram } from '@braidhq/schema'
import { Mermaid } from '@/components/SkillTranscript/Mermaid'

export function ShowDiagramBlock({ block }: { block: ShowDiagram }) {
  return (
    <figure className="my-1">
      {block.title && (
        <figcaption className="mb-2 text-sm font-semibold text-foreground">{block.title}</figcaption>
      )}
      <div className="overflow-x-auto rounded-md border border-border bg-card px-3 py-3">
        <Mermaid definition={block.mermaid} />
      </div>
      {block.caption && (
        <figcaption className="mt-1.5 text-2xs text-muted-foreground">{block.caption}</figcaption>
      )}
    </figure>
  )
}
