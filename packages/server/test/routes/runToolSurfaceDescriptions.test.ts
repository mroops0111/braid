import { dddOntology } from '@braidhq/ontology-ddd'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRunnerApp, endAllSpawned } from '../helpers/runnerApp.js'

/**
 * What a run's tools say about themselves, checked on the served spec.
 *
 * The spec is the only place an MCP tool's prose can come from.
 * `openapi-mcp-gateway` copies a field's `description` into the tool's
 * `inputSchema` at every depth and adds nothing of its own,
 * so a field left undescribed here reaches the model as a bare type.
 * A TS comment does not exist at runtime and a skill prompt reaches one skill,
 * which is why neither counts as documenting a field.
 */

type Schema = Record<string, unknown>
type Operation = Record<string, unknown>

interface Surface {
  readonly paths: Record<string, Record<string, unknown>>
  readonly components?: { readonly schemas?: Record<string, Schema> }
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const

/**
 * The pairings a run is actually served, one spec each.
 *
 * Composing the app is the slow part, by an order of magnitude,
 * so a surface is read once and every check below reads the same document.
 */
const PAIRINGS = [
  { category: 'ask', form: 'prose' },
  { category: 'ask', form: 'blocks' },
  { category: 'build', form: 'blocks' },
  { category: 'generate', form: 'blocks' },
] as const

const served = new Map<string, Promise<Surface>>()

function surface(category: string, form: string): Promise<Surface> {
  const key = `${category}/${form}`
  const read = served.get(key) ?? readSurface(category, form)
  served.set(key, read)
  return read
}

// The full composition, since the render operations only reach the document
// with a runner wired, and they are half of what a run is offered.
async function readSurface(category: string, form: string): Promise<Surface> {
  const { app } = await buildRunnerApp()
  const response = await app.request(`/openapi/runs/${category}/${form}/openapi.json`)
  expect(response.status).toBe(200)
  return await response.json() as Surface
}

function operationsOf(document: Surface): Array<{ id: string, operation: Operation }> {
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

function everyDescription(document: Surface): readonly string[] {
  const found: string[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value)
        visit(item)
      return
    }
    if (typeof value !== 'object' || value === null)
      return
    for (const [key, held] of Object.entries(value)) {
      if ((key === 'description' || key === 'summary') && typeof held === 'string')
        found.push(held)
      else visit(held)
    }
  }
  visit(document)
  return found
}

describe('every field a run is asked to fill', () => {
  afterEach(endAllSpawned)

  // What a field means belongs where every caller reads it.
  // The alternative was one skill's prompt explaining it,
  // which is how `clarificationId` came to be a rule only `clarify` knew.
  it.each(PAIRINGS)('says what it is on a $category run writing $form', async ({ category, form }) => {
    const document = await surface(category, form)
    const undescribed = operationsOf(document).flatMap(({ id, operation }) => {
      const body = bodySchemaOf(operation)
      return body ? undescribedFields(document, body, id) : []
    })
    expect([...new Set(undescribed)].sort()).toEqual([])
  })

  // The gateway reads a parameter's own `description` rather than its schema's,
  // so prose that reached only the schema would never be shown to a model.
  // A `.describe()` on the zod schema lands on both, which is why it counts.
  it.each(PAIRINGS)('says what it is on a $category run\'s path and query, writing $form', async ({ category, form }) => {
    const document = await surface(category, form)
    const undescribed = operationsOf(document).flatMap(({ id, operation }) =>
      parametersOf(operation)
        .filter(parameter => !describes(parameter))
        .map(parameter => `${id}.${String(parameter.name)}`))
    expect([...new Set(undescribed)].sort()).toEqual([])
  })

  // A tool with no prose at all is a name and a shape,
  // and the name is the only part a model reads before deciding.
  it.each(PAIRINGS)('says what the operation does on a $category run writing $form', async ({ category, form }) => {
    const document = await surface(category, form)
    const silent = operationsOf(document)
      .filter(({ operation }) => !describes({ description: operation.summary }))
      .map(({ id }) => id)
    expect(silent).toEqual([])
  })
})

describe('the prose a run is served', () => {
  afterEach(endAllSpawned)

  // The framework serves whatever ontology a workspace declares,
  // so a description naming one ontology's world is wrong in every other.
  // The same rule the framework skills are held to, one layer down.
  it.each(PAIRINGS)('names no vocabulary only one ontology would have, on a $category run writing $form', async ({ category, form }) => {
    const document = await surface(category, form)
    const named = everyDescription(document).flatMap(prose => [
      ...ontologyIds().filter(id => new RegExp(`\\b${id}\\b`).test(prose)),
      ...ONTOLOGY_PROSE.filter(pattern => pattern.test(prose)).map(String),
    ])
    expect([...new Set(named)].sort()).toEqual([])
  })
})
