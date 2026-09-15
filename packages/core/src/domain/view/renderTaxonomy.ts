import type { GraphNode, ModelSnapshot, NodeId, NodeTypeId } from '@braidhq/schema'
import type { NodeTypeDescriptor } from '../plugin/OntologyPlugin.js'

/**
 * How an ontology says a document out of it is laid out.
 *
 * Derived from `renderHint` alone,
 * so the walk never names `aggregate` or `command`.
 * An ontology declaring its own chains renders without an edit here,
 * which is the whole reason the hints exist.
 */
export interface RenderTaxonomy {
  /** Types whose nodes each make a document of their own. */
  readonly containerTypes: readonly NodeTypeId[]
  /** The type whose nodes hold this one's, for a type that nests. */
  readonly parentOf: ReadonlyMap<NodeTypeId, NodeTypeId>
  /** The heading a flat list of this type renders under. */
  readonly sectionOf: ReadonlyMap<NodeTypeId, string>
  /** Types carrying no hint, recorded in a footer rather than the body. */
  readonly leafTypes: ReadonlySet<NodeTypeId>
}

export function renderTaxonomyOf(nodeTypes: readonly NodeTypeDescriptor[]): RenderTaxonomy {
  const containerTypes: NodeTypeId[] = []
  const parentOf = new Map<NodeTypeId, NodeTypeId>()
  const sectionOf = new Map<NodeTypeId, string>()
  const leafTypes = new Set<NodeTypeId>()

  for (const descriptor of nodeTypes) {
    const hint = descriptor.renderHint
    if (hint?.container === true)
      containerTypes.push(descriptor.id)
    if (hint?.expandedUnder !== undefined)
      parentOf.set(descriptor.id, hint.expandedUnder)
    // A flat list only where nothing else already places the type.
    // One that nests is drawn under its parent,
    // and a container is itself the document,
    // so treating either as a section lists it beside itself.
    // An ontology may set `section` on a container to name its body,
    // and reading that as a list lists every sibling container.
    else if (hint?.section !== undefined && hint.container !== true)
      sectionOf.set(descriptor.id, hint.section)
    if (hint === undefined || (hint.container !== true && hint.expandedUnder === undefined && hint.section === undefined))
      leafTypes.add(descriptor.id)
  }

  return { containerTypes, parentOf, sectionOf, leafTypes }
}

/**
 * Every type the chains put above this one, nearest first.
 *
 * A chain that loops stops the walk rather than hanging it,
 * since an ontology is authored by hand and one that loops still renders.
 */
function ancestorTypesOf(taxonomy: RenderTaxonomy, type: NodeTypeId): readonly NodeTypeId[] {
  const above: NodeTypeId[] = []
  const seen = new Set<NodeTypeId>([type])
  let at = taxonomy.parentOf.get(type)
  while (at !== undefined && !seen.has(at)) {
    above.push(at)
    seen.add(at)
    at = taxonomy.parentOf.get(at)
  }
  return above
}

/** One node in a document tree, with whatever the chains hang beneath it. */
export interface DocumentBranch {
  readonly node: GraphNode
  readonly children: readonly DocumentBranch[]
}

/** A flat list of one type, rendered under its own heading. */
export interface DocumentSection {
  readonly label: string
  readonly nodes: readonly GraphNode[]
}

/**
 * One container written out, as the structure a renderer walks.
 *
 * `leafNodeIds` are in scope and deliberately not in the body.
 * They are what a footer names,
 * so a reader can trace the document without the prose carrying ids.
 */
export interface DocumentTree {
  readonly container: GraphNode
  readonly branches: readonly DocumentBranch[]
  readonly sections: readonly DocumentSection[]
  readonly leafNodeIds: readonly NodeId[]
}

export interface DocumentTreeInput {
  readonly taxonomy: RenderTaxonomy
  readonly model: ModelSnapshot
  readonly containerId: NodeId
}

/**
 * Walk one container into the tree a document is written from.
 *
 * Scope grows along the chains the ontology declared, never by distance.
 * A node joins because something in scope is the kind that holds it,
 * so a type whose declared parent is not there stays out,
 * rather than being promoted to a part of its own.
 * Walking by distance reaches a sibling container in a few steps,
 * and writes it up as though this document were about it.
 *
 * Which edge carries containment is the ontology's word, not the renderer's,
 * so adjacency decides whether two nodes are related at all,
 * and the declared chains decide what that relation means.
 */
export function documentTreeOf(input: DocumentTreeInput): DocumentTree | undefined {
  const { taxonomy, model, containerId } = input
  const nodeById = new Map(model.nodes.map(node => [node.id, node]))
  const container = nodeById.get(containerId)
  if (container === undefined)
    return undefined

  const neighbours = adjacencyOf(model)
  const seen = new Set<NodeId>([containerId])
  const childrenOf = new Map<NodeId, GraphNode[]>()
  const listed = new Map<string, GraphNode[]>()
  const leafNodeIds: NodeId[] = []

  // Only a node that holds others is expanded from,
  // so a flat list and a footnote end the walk rather than carrying it on.
  let frontier: GraphNode[] = [container]
  while (frontier.length > 0) {
    const next: GraphNode[] = []
    for (const held of frontier) {
      for (const id of neighbours.get(held.id) ?? []) {
        const node = nodeById.get(id)
        if (node === undefined || seen.has(id))
          continue

        if (taxonomy.parentOf.get(node.type) === held.type) {
          seen.add(id)
          childrenOf.set(held.id, [...(childrenOf.get(held.id) ?? []), node])
          next.push(node)
          continue
        }

        const section = taxonomy.sectionOf.get(node.type)
        if (section !== undefined) {
          seen.add(id)
          listed.set(section, [...(listed.get(section) ?? []), node])
          continue
        }

        if (taxonomy.leafTypes.has(node.type)) {
          seen.add(id)
          leafNodeIds.push(id)
        }
      }
    }
    frontier = next
  }

  // An ontology may let a type attach further up its own chain,
  // an invariant of a whole aggregate rather than of one command on it.
  // Those nodes are about this subject and would otherwise be dropped,
  // so they are taken second, after exact placement has had its chance.
  // A type whose chain does not run through the holder at all stays out,
  // which keeps a neighbouring subject's work from being written up here.
  for (const holder of [...seen].map(id => nodeById.get(id)).filter(isNode)) {
    for (const id of neighbours.get(holder.id) ?? []) {
      const node = nodeById.get(id)
      if (node === undefined || seen.has(id))
        continue
      if (!ancestorTypesOf(taxonomy, node.type).includes(holder.type))
        continue
      seen.add(id)
      childrenOf.set(holder.id, [...(childrenOf.get(holder.id) ?? []), node])
    }
  }

  const branchOf = (node: GraphNode): DocumentBranch => ({
    node,
    children: (childrenOf.get(node.id) ?? []).map(branchOf),
  })

  return {
    container,
    branches: (childrenOf.get(containerId) ?? []).map(branchOf),
    sections: [...listed.entries()].map(([label, nodes]) => ({ label, nodes })),
    leafNodeIds,
  }
}

function isNode(node: GraphNode | undefined): node is GraphNode {
  return node !== undefined
}

function adjacencyOf(model: ModelSnapshot): ReadonlyMap<NodeId, ReadonlySet<NodeId>> {
  const neighbours = new Map<NodeId, Set<NodeId>>()
  const link = (from: NodeId, to: NodeId): void => {
    const held = neighbours.get(from) ?? new Set<NodeId>()
    held.add(to)
    neighbours.set(from, held)
  }
  for (const edge of model.edges) {
    link(edge.fromNodeId, edge.toNodeId)
    link(edge.toNodeId, edge.fromNodeId)
  }
  return neighbours
}
