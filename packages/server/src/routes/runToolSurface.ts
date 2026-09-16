import type { OutputForm, SkillCategory } from '@braidhq/schema'
import { RUN_CATEGORIES_KEY, RUN_OUTPUT_FORMS_KEY } from './_shared.js'

type Operation = Record<string, unknown>
type PathItem = Record<string, unknown>

/** Everything an OpenAPI path item can hold that is an operation. */
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const

// Unmarked is visible, which is right for a read,
// and keeps the marking to the operations that actually need narrowing.
function permits(operation: Operation, key: string, value: string): boolean {
  const declared = operation[key]
  if (!Array.isArray(declared))
    return true
  return (declared as readonly string[]).includes(value)
}

function visibleTo(operation: Operation, category: SkillCategory, form: OutputForm): boolean {
  return permits(operation, RUN_CATEGORIES_KEY, category)
    && permits(operation, RUN_OUTPUT_FORMS_KEY, form)
}

/**
 * The spec a run's gateway is given, holding only what that run may call.
 *
 * A run's tools come from its spec,
 * so narrowing the spec is what narrows the tools.
 * The alternative was a prompt asking a skill not to reach for what it sees,
 * and the operation still costs a place in the tool list,
 * and the tokens to describe it, whether or not it is ever called.
 * That cost is the whole point of the `form` axis:
 * a run asked for prose is not told to leave the render tools alone,
 * it is never shown them.
 *
 * Braid's own markers are dropped on the way out.
 * They say which runs may see an operation,
 * which is answered by the time the document is built,
 * and the gateway has no use for them.
 */
export function toolSurfaceFor(
  document: Record<string, unknown>,
  category: SkillCategory,
  form: OutputForm = 'blocks',
): Record<string, unknown> {
  const paths = document.paths as Record<string, PathItem> | undefined
  if (!paths)
    return document

  const kept: Record<string, PathItem> = {}
  for (const [path, item] of Object.entries(paths)) {
    const survivors: PathItem = {}
    let anyOperation = false
    for (const [key, value] of Object.entries(item)) {
      if (!(METHODS as readonly string[]).includes(key)) {
        survivors[key] = value
        continue
      }
      const operation = value as Operation
      if (!visibleTo(operation, category, form))
        continue
      anyOperation = true
      const { [RUN_CATEGORIES_KEY]: _categories, [RUN_OUTPUT_FORMS_KEY]: _forms, ...rest } = operation
      survivors[key] = rest
    }
    // A path left with nothing but its shared parameters describes no call.
    if (anyOperation)
      kept[path] = survivors
  }

  return { ...document, paths: kept }
}
