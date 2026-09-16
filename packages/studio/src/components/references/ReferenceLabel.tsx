import { splitReferences } from '@braidhq/schema'
import { Fragment, useMemo } from 'react'
import { useReferenceRegistry } from '@/lib/references/ReferenceRegistryContext'

/**
 * A field whose `@kind:id` tokens read as the names they stand for, as text.
 *
 * `ReferenceText` is the one to reach for, since a tag is worth more than a
 * name. This is for the two places a tag cannot go: inside a control, where a
 * button within a button is invalid, and inside a card a tag already opened,
 * where a second tag offers a card behind the card being read.
 *
 * An unresolved token falls back to its id rather than to the token,
 * because the id is the part a reader could have looked up either way.
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
