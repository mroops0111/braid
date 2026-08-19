import { splitReferences } from '@braidhq/schema'
import { Fragment, useMemo } from 'react'
import { ReferenceTag } from './ReferenceTag'

/**
 * Renders a plain-text field whose `@kind:id` tokens become tags.
 * Markdown bodies go through `Markdown` instead, which runs the same split,
 * over the parsed tree so tokens inside lists and tables are covered too.
 * Emits no wrapper, the caller keeps its own block element and styling.
 */
export function ReferenceText({ text }: { text: string }) {
  const segments = useMemo(() => splitReferences(text), [text])
  return (
    <>
      {segments.map((segment, index) => (
        segment.type === 'text'
          ? <Fragment key={index}>{segment.text}</Fragment>
          : <ReferenceTag key={index} reference={segment.reference} />
      ))}
    </>
  )
}
