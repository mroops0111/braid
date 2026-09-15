import type { NodeId, ViewArtifactFormat, ViewFormId, ViewKind } from '@braidhq/schema'
import { ViewArtifactFormat as FormatSchema, ViewFormId as FormIdSchema, ViewKind as KindSchema, NodeId as NodeIdSchema } from '@braidhq/schema'

export interface ViewPathParts {
  readonly kind: ViewKind
  readonly form: ViewFormId
  readonly subject: NodeId
  readonly format: ViewArtifactFormat
}

/**
 * Where a written view lands, and what a reader asks for it by.
 *
 * The subject is escaped rather than flattened,
 * so the node it was written out of survives the trip through a filename.
 * Replacing a separator with a hyphen makes the mapping one-way,
 * since a node id may already carry a hyphen,
 * and a regenerate would then be guessing which document it meant.
 */
export function viewPathOf(parts: ViewPathParts): string {
  return `${parts.kind}/${parts.form}/${encodeURIComponent(parts.subject)}.${parts.format}`
}

/** The parts of a view path, or nothing where it names no view this wrote. */
export function viewPathParts(path: string): ViewPathParts | undefined {
  const [kind, form, name, ...rest] = path.split('/')
  if (kind === undefined || form === undefined || name === undefined || rest.length > 0)
    return undefined

  const dot = name.lastIndexOf('.')
  if (dot <= 0)
    return undefined

  const parsed = {
    kind: KindSchema.safeParse(kind),
    form: FormIdSchema.safeParse(form),
    subject: NodeIdSchema.safeParse(decodedOr(name.slice(0, dot))),
    format: FormatSchema.safeParse(name.slice(dot + 1)),
  }
  if (!parsed.kind.success || !parsed.form.success || !parsed.subject.success || !parsed.format.success)
    return undefined

  return {
    kind: parsed.kind.data,
    form: parsed.form.data,
    subject: parsed.subject.data,
    format: parsed.format.data,
  }
}

// An unescapable name is one nothing here wrote, so it names no subject.
function decodedOr(encoded: string): string {
  try {
    return decodeURIComponent(encoded)
  }
  catch {
    return ''
  }
}
