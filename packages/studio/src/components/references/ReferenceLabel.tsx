import { splitReferences } from '@braidhq/schema'
import { Fragment, useMemo } from 'react'
import { useReferenceRegistry } from '@/lib/references/ReferenceRegistryContext'

/**
 * A field whose `@kind:id` tokens read as the names they stand for, as text.
 *
 * `ReferenceText` is the one to reach for, since a tag is worth more than a name.
 * This is for where a tag cannot go,
 * inside a control, or inside a card a tag already opened.
 *
 * An unresolved token falls back to its id, which a reader could have read anyway.
 */
export function ReferenceLabel({ text }: { text: string }) {
  const registry = useReferenceRegistry()
  const segments = useMemo(() => splitReferences(text), [text])
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.type === 'text'
            ? segment.text
            : registry?.resolve(segment.reference)?.title ?? segment.reference.id}
        </Fragment>
      ))}
    </>
  )
}
