import { dddOntology } from '@braidhq/ontology-ddd'

/**
 * What a tool tells a model about itself, read off a served spec.
 *
 * The spec is the only place an MCP tool's prose can come from.
 * `openapi-mcp-gateway` copies a field's `description` into the tool's
 * `inputSchema` at every depth and adds nothing of its own,
 * so a field left undescribed reaches the model as a bare type.
 * A TS comment does not exist at runtime and a skill prompt reaches one skill,
 * which is why neither counts as documenting a field.
 *
 * Shared because Braid serves two kinds of tool surface from one spec.
 * A run is handed a narrowed document per category and form,
 * and the deployment's own endpoint exposes the operations marked for it,
 * and both become tools through the same gateway.
 */

export type Schema = Record<string, unknown>
export type Operation = Record<string, unknown>

export interface Surface {
  readonly paths: Record<string, Record<string, unknown>>
  readonly components?: { readonly schemas?: Record<string, Schema> }
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const

export function operationsOf(document: Surface): Array<{ id: string, operation: Operation }> {
  return Object.values(document.paths).flatMap(item =>
    Object.entries(item)
      .filter(([method]) => (METHODS as readonly string[]).includes(method))
      .map(([, value]) => value as Operation)
      .filter(operation => typeof operation.operationId === 'string')
      .map(operation => ({ id: operation.operationId as string, operation })),
  )
}

function refName(node: Schema): string | undefined {
  const ref = node.$ref
  return typeof ref === 'string' ? ref.split('/').pop() : undefined
}

function resolve(document: Surface, node: Schema): Schema {
  const name = refName(node)
  return name ? document.components?.schemas?.[name] ?? {} : node
}

function describes(node: Schema | undefined): boolean {
  return typeof node?.description === 'string' && node.description.trim().length > 0
}

function armsOf(node: Schema): readonly Schema[] | undefined {
  for (const branch of ['anyOf', 'oneOf', 'allOf'] as const) {
    const arms = node[branch]
    if (Array.isArray(arms))
      return arms as readonly Schema[]
  }
  return undefined
}

function propertiesOf(node: Schema): Record<string, Schema> | undefined {
  const properties = node.properties
  return typeof properties === 'object' && properties !== null
    ? properties as Record<string, Schema>
    : undefined
}

/**
 * Every request-body field a caller must decide about with no prose to go on.
 *
 * `$ref` is followed because the gateway expands it, so a component's
 * description is what the model sees at the use site.
 * A cycle stops at the component that closes it, which cannot add a path
 * the walk has not already reported once.
 */
function undescribedFields(
  document: Surface,
  node: Schema,
  at: string,
  seen: readonly string[] = [],
): readonly string[] {
  const name = refName(node)
  if (name && seen.includes(name))
    return []
  const schema = resolve(document, node)
  const chain = name ? [...seen, name] : seen

  const properties = propertiesOf(schema)
  if (properties) {
    return Object.entries(properties).flatMap(([key, value]) =>
      undescribedFields(document, value, `${at}.${key}`, chain))
  }

  const arms = armsOf(schema)
  if (arms) {
    const objects = arms.filter(arm => propertiesOf(resolve(document, arm)))
    // A union of scalars is one decision, so the field carries the prose.
    // A union of shapes is a choice between shapes, and the walk goes on into
    // each, where the discriminant is what has to say which shape it names.
    if (objects.length === 0)
      return describes(node) || describes(schema) ? [] : [at]
    return objects.flatMap(arm => undescribedFields(document, arm, at, chain))
  }

  const items = schema.items
  if (typeof items === 'object' && items !== null) {
    const item = resolve(document, items as Schema)
    // A list of plain values is one decision, so the list carries the prose.
    // A list of shapes is many, so the walk goes on into the shape.
    const shaped = propertiesOf(item) !== undefined || armsOf(item) !== undefined
    if (!shaped && (describes(node) || describes(schema) || describes(items as Schema) || describes(item)))
      return []
    return undescribedFields(document, items as Schema, `${at}[]`, chain)
  }

  return describes(node) || describes(schema) ? [] : [at]
}

function bodySchemaOf(operation: Operation): Schema | undefined {
  const body = operation.requestBody as { content?: Record<string, { schema?: Schema }> } | undefined
  return body?.content?.['application/json']?.schema
}

function parametersOf(operation: Operation): readonly Schema[] {
  const declared = operation.parameters
  return Array.isArray(declared) ? declared as readonly Schema[] : []
}

/** Every body field of `operations` with nothing to go on, by path, sorted. */
export function undescribedBodyFields(
  document: Surface,
  operations: Array<{ id: string, operation: Operation }>,
): readonly string[] {
  const found = operations.flatMap(({ id, operation }) => {
    const body = bodySchemaOf(operation)
    return body ? undescribedFields(document, body, id) : []
  })
  return [...new Set(found)].sort()
}

/**
 * Every path and query parameter of `operations` with nothing to go on.
 *
 * The gateway reads a parameter's own `description` rather than its schema's,
 * so prose that reached only the schema would never be shown to a model.
 * A `.describe()` on the zod schema lands on both, which is why it counts.
 */
export function undescribedParameters(
  operations: Array<{ id: string, operation: Operation }>,
): readonly string[] {
  const found = operations.flatMap(({ id, operation }) =>
    parametersOf(operation)
      .filter(parameter => !describes(parameter))
      .map(parameter => `${id}.${String(parameter.name)}`))
  return [...new Set(found)].sort()
}

/**
 * Operations that reach a model with no prose at all, by id.
 *
 * The gateway falls back from an override to `description` to `summary`,
 * and then to the method and path, which says nothing a caller can act on.
 */
export function silentOperations(
  operations: Array<{ id: string, operation: Operation }>,
): readonly string[] {
  return operations
    .filter(({ operation }) => {
      const integration = operation['x-mcp-integration'] as { tool?: { description?: unknown } } | undefined
      const override = integration?.tool?.description
      return !(typeof override === 'string' && override.trim().length > 0)
        && !describes(operation)
        && !describes({ description: operation.summary })
    })
    .map(({ id }) => id)
    .sort()
}

/**
 * Ids only one ontology would have, as the skill prompts are checked for.
 *
 * Narrowed to the ids no English sentence would use by accident,
 * since a description saying `query` or `rule` is almost always writing English.
 */
function ontologyIds(): readonly string[] {
  return [
    ...dddOntology.nodeTypes.map(type => String(type.id)),
    ...dddOntology.sourceRoles.map(role => String(role.id)),
    ...(dddOntology.audiences ?? []).map(audience => String(audience.id)),
  ].filter(id => /[a-z][A-Z]/.test(id))
}

/** Prose that names one ontology's world without quoting an id. */
const ONTOLOGY_PROSE = [
  /\bbusiness reader\b/i,
  /\ban engineer\b/i,
  /\bspec and the code\b/i,
]

function everyDescription(held: unknown): readonly string[] {
  const found: string[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value)
        visit(item)
      return
    }
    if (typeof value !== 'object' || value === null)
      return
    for (const [key, nested] of Object.entries(value)) {
      if ((key === 'description' || key === 'summary') && typeof nested === 'string')
        found.push(nested)
      else visit(nested)
    }
  }
  visit(held)
  return found
}

/**
 * Vocabulary in `held` that only one ontology would have, by what it named.
 *
 * The framework serves whatever ontology a workspace declares,
 * so a description naming one ontology's world is wrong in every other.
 * The same rule the framework skills are held to, one layer down.
 */
export function ontologyVocabularyIn(held: unknown): readonly string[] {
  const named = everyDescription(held).flatMap(prose => [
    ...ontologyIds().filter(id => new RegExp(`\\b${id}\\b`).test(prose)),
    ...ONTOLOGY_PROSE.filter(pattern => pattern.test(prose)).map(String),
  ])
  return [...new Set(named)].sort()
}
