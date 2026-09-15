import type { DocumentBranch, NodeTypeDescriptor, RenderTaxonomy } from '@braidhq/core'
import type { GraphNode, LocalizedText, ModelSnapshot, NodeId, NodeStatus, NodeTypeId } from '@braidhq/schema'
import { documentTreeOf, renderTaxonomyOf } from '@braidhq/core'

/**
 * A type's name as the ontology gave it, translations and all.
 *
 * Carried rather than flattened to one locale,
 * so a document written out of a graph kept in one language,
 * is not carrying a single word on the page in another.
 */
export type TypeLabel = LocalizedText

export interface MaterialNode {
  readonly id: NodeId
  readonly name: string
  /** Absent where the graph holds none, rather than present and empty. */
  readonly description?: string
  readonly status: NodeStatus
  readonly typeLabel: TypeLabel
  readonly holds: readonly MaterialNode[]
}

export interface MaterialSection {
  readonly label: string
  readonly nodes: readonly MaterialNode[]
}

/** A node whose status says the graph is not finished with it. */
export interface MaterialConcern {
  readonly id: NodeId
  readonly name: string
  readonly status: NodeStatus
}

/**
 * Everything a form is handed, and nothing about how to write it.
 *
 * A projection of the graph,
 * so the same graph and subject produce the same bytes.
 * That is what lets a written document be told it has gone stale,
 * by comparing this against what it was written from.
 */
export interface DocumentMaterial {
  readonly subject: NodeId
  readonly title: string
  readonly description?: string
  readonly status: NodeStatus
  readonly typeLabel: TypeLabel
  readonly sections: readonly MaterialSection[]
  readonly holds: readonly MaterialNode[]
  /** Nodes the graph is still unsure of, which a document must not hide. */
  readonly concerns: readonly MaterialConcern[]
  /** Everything in scope, so a footer can trace the document to the graph. */
  readonly sourceNodeIds: readonly NodeId[]
}

const SETTLED: NodeStatus = 'completed'

export interface ProjectInput {
  readonly model: ModelSnapshot
  readonly nodeTypes: readonly NodeTypeDescriptor[]
  readonly subject: NodeId
}

export function projectDocument(input: ProjectInput): DocumentMaterial | undefined {
  const taxonomy = renderTaxonomyOf(input.nodeTypes)
  const tree = documentTreeOf({ taxonomy, model: input.model, containerId: input.subject })
  if (tree === undefined)
    return undefined

  const labels = labelsOf(input.nodeTypes)
  const nodeById = new Map(input.model.nodes.map(node => [node.id, node]))
  const holds = ordered(tree.branches.map(branch => materialOf(branch, labels)))
  const sections = tree.sections
    .map(section => ({
      label: section.label,
      nodes: ordered(section.nodes.map(node => leafOf(node, labels))),
    }))
    .sort((one, other) => one.label.localeCompare(other.label))

  const sourceNodeIds = [
    tree.container.id,
    ...collectIds(holds),
    ...sections.flatMap(section => collectIds(section.nodes)),
    ...tree.leafNodeIds,
  ]

  return {
    subject: tree.container.id,
    title: tree.container.name,
    ...(tree.container.description === undefined ? {} : { description: tree.container.description }),
    status: tree.container.status,
    typeLabel: labelFor(labels, tree.container.type),
    sections,
    holds,
    concerns: concernsIn(sourceNodeIds, nodeById),
    sourceNodeIds: [...new Set(sourceNodeIds)].sort(),
  }
}

function materialOf(branch: DocumentBranch, labels: ReadonlyMap<NodeTypeId, TypeLabel>): MaterialNode {
  return {
    ...leafOf(branch.node, labels),
    holds: ordered(branch.children.map(child => materialOf(child, labels))),
  }
}

function leafOf(node: GraphNode, labels: ReadonlyMap<NodeTypeId, TypeLabel>): MaterialNode {
  return {
    id: node.id,
    name: node.name,
    ...(node.description === undefined ? {} : { description: node.description }),
    status: node.status,
    typeLabel: labelFor(labels, node.type),
    holds: [],
  }
}

/**
 * One order, so the same graph writes the same document.
 *
 * By name, since that is the order a reader would scan,
 * and by id where two carry one name,
 * since a tie broken arbitrarily is a tie broken differently next run.
 */
function ordered(nodes: readonly MaterialNode[]): readonly MaterialNode[] {
  return [...nodes].sort((one, other) =>
    one.name.localeCompare(other.name) || one.id.localeCompare(other.id))
}

function collectIds(nodes: readonly MaterialNode[]): readonly NodeId[] {
  return nodes.flatMap(node => [node.id, ...collectIds(node.holds)])
}

function concernsIn(
  ids: readonly NodeId[],
  nodeById: ReadonlyMap<NodeId, GraphNode>,
): readonly MaterialConcern[] {
  const seen = new Set<NodeId>()
  const concerns: MaterialConcern[] = []
  for (const id of ids) {
    const node = nodeById.get(id)
    if (node === undefined || node.status === SETTLED || seen.has(id))
      continue
    seen.add(id)
    concerns.push({ id: node.id, name: node.name, status: node.status })
  }
  return concerns.sort((one, other) => one.id.localeCompare(other.id))
}

function labelsOf(nodeTypes: readonly NodeTypeDescriptor[]): ReadonlyMap<NodeTypeId, TypeLabel> {
  return new Map(nodeTypes.map(descriptor => [descriptor.id, descriptor.label]))
}

function labelFor(labels: ReadonlyMap<NodeTypeId, TypeLabel>, type: NodeTypeId): TypeLabel {
  // A type the ontology no longer declares still names itself,
  // which reads better on a page than a blank where a kind should be.
  return labels.get(type) ?? type
}

/** The container types a reader may ask for a document of. */
export function containerTypesOf(nodeTypes: readonly NodeTypeDescriptor[]): RenderTaxonomy['containerTypes'] {
  return renderTaxonomyOf(nodeTypes).containerTypes
}
