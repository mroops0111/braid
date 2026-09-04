import type { EmbeddingService, ModelService } from '@braidhq/core'
import { applyNodeFilter, fuseByRank, ValidationError } from '@braidhq/core'
import { GraphNode, ModelSnapshot, NodeId, NodeStatus, NodeTypeId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { ontologyFor, type OntologyLookupDeps } from './_ontology.js'
import { mcpReadTool, NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'

// Unfiltered, this endpoint returns the whole graph,
// which on a mature one is most of a megabyte. A caller wanting more says so,
// and a caller wanting all of it wants the snapshot instead.
const DEFAULT_LIMIT = 20
// A ceiling on what one call can cost a caller's context.
// Reading the whole graph is what the snapshot is for.
const MAX_LIMIT = 100

function capped(nodes: readonly GraphNode[], limit: number): GraphNode[] {
  return nodes.slice(0, limit)
}

const NodeIdParam = WorkspaceIdParam.extend({
  nodeId: NodeId.openapi({ param: { name: 'nodeId', in: 'path' } }),
})

const ScopeQuery = z.object({
  depth: z.coerce.number().int().positive().default(2).openapi({ description: 'How many hops to traverse from the seed node.' }),
})

const NodeListResponse = z.object({
  items: z.array(GraphNode),
  /**
   * How many matched before `limit` cut the list.
   *
   * Without it a complete answer reads like the first page of a wide one,
   * and under a cap that decides whether to read on or narrow the query.
   */
  total: z.number().int().openapi({ description: 'Nodes matching the filters, before `limit` truncates.' }),
}).openapi('NodeListResponse')

export interface NodesRouterDeps extends OntologyLookupDeps {
  modelService: ModelService
  /**
   * Absent when the deployment configures no embedding backend,
   * which makes `semantic` a no-op rather than an error.
   */
  embeddingService?: EmbeddingService
}

const getNodeRoute = createRoute(mcpReadTool({
  method: 'get',
  path: '/{nodeId}',
  operationId: 'getNode',
  summary: 'Fetch a single node by id.',
  tags: ['nodes'],
  request: { params: NodeIdParam },
  responses: {
    200: {
      description: 'The requested node.',
      content: { 'application/json': { schema: GraphNode } },
    },
    404: NotFoundResponse,
  },
}))

const scopeRoute = createRoute(mcpReadTool({
  method: 'get',
  path: '/{nodeId}/scope',
  operationId: 'getNodeScope',
  summary: 'Return the subgraph reachable from a node within a depth budget.',
  tags: ['nodes'],
  request: {
    params: NodeIdParam,
    query: ScopeQuery,
  },
  responses: {
    200: {
      description: 'A scoped subgraph (nodes + edges) around the seed node.',
      content: { 'application/json': { schema: ModelSnapshot } },
    },
    404: NotFoundResponse,
  },
}))

const listQuery = z.object({
  type: z.union([NodeTypeId, z.array(NodeTypeId)]).optional().openapi({
    description: 'Filter by node type. Pass one or many. `getOntology` describes what each type means.',
  }),
  status: z.union([NodeStatus, z.array(NodeStatus)]).optional().openapi({ description: 'Filter by node status. Pass one or many.' }),
  q: z.string().optional().openapi({ description: 'Case-insensitive substring match against node name and description.' }),
  // Parsed as a string because a query parameter is one,
  // and declared as a boolean because that is what it means.
  // `coerce.boolean` gets the first half wrong,
  // running `Boolean(value)` so that "false" arrives as true.
  semantic: z.stringbool().default(true).openapi({
    // Spelling out `type` replaces the generated schema, it does not merge,
    // so the default has to be restated here or it is lost.
    type: 'boolean',
    default: true,
    description: 'Rank by meaning as well as by substring, fusing the two. On by default, and ignored where the deployment configures no embedding backend or the query is empty. Pass false for substring matching alone.',
  }),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT).openapi({
    description: 'Cap on returned nodes, best ranked first. Defaults to 20, so narrow with `q` rather than raising this to read the whole graph.',
  }),
})

const listNodesRoute = createRoute(mcpReadTool({
  method: 'get',
  path: '/',
  operationId: 'listNodes',
  summary: 'Search graph nodes by type, status, and a substring of the name or description.',
  tags: ['nodes'],
  request: {
    params: WorkspaceIdParam,
    query: listQuery,
  },
  responses: {
    200: {
      description: 'A page of matching nodes.',
      content: { 'application/json': { schema: NodeListResponse } },
    },
    400: ValidationFailureResponse,
  },
}))

export function createNodesRouter(deps: NodesRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(listNodesRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { type, status, q, semantic, limit } = context.req.valid('query')
    const types = type === undefined ? undefined : Array.isArray(type) ? type : [type]
    const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
    // The structural filters decide what is eligible at all,
    // so they run once and both retrievers rank within what survives them.
    // Checked against the workspace's own ontology,
    // because an undefined type is a mistake, not a filter matching nothing.
    // Answering 200 and an empty list hides a typo behind a true absence,
    // and leaves a caller with nothing to correct.
    if (types) {
      const ontology = await ontologyFor(deps, workspaceId)
      const known = new Set(ontology.nodeTypes.map(nodeType => nodeType.id))
      const unknown = types.filter(candidate => !known.has(candidate))
      if (unknown.length > 0) {
        throw new ValidationError(
          `Unknown node type ${unknown.map(id => `"${id}"`).join(', ')}. `
          + `Workspace "${workspaceId}" uses ontology "${ontology.ontologyId}", whose node types are `
          + `${ontology.nodeTypes.map(nodeType => nodeType.id).join(', ')}.`,
        )
      }
    }
    const eligible = await deps.modelService.listNodes(workspaceId, { types, statuses })
    const lexical = applyNodeFilter(eligible, q ? { textContains: q } : undefined)
    if (!semantic || !q || !deps.embeddingService)
      return context.json({ items: capped(lexical, limit), total: lexical.length }, 200)

    const byId = new Map<string, GraphNode>(eligible.map(node => [node.id, node]))
    const hits = await deps.embeddingService.search(workspaceId, q, limit)
    const semanticNodes = hits
      .map(hit => byId.get(hit.nodeId))
      .filter((node): node is GraphNode => node !== undefined)

    // Rank fusion rather than a blended score,
    // since a substring hit count and a cosine distance,
    // have no common scale to be weighed on.
    const fused = fuseByRank([lexical, semanticNodes], node => node.id)
    return context.json({ items: capped(fused, limit), total: fused.length }, 200)
  })

  router.openapi(getNodeRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { nodeId } = context.req.valid('param')
    const node = await deps.modelService.getNode(workspaceId, nodeId)
    return context.json(node, 200)
  })

  router.openapi(scopeRoute, async (context) => {
    const workspaceId = getWorkspaceId(context)
    const { nodeId } = context.req.valid('param')
    const { depth } = context.req.valid('query')
    const snapshot = await deps.modelService.scopeOf(workspaceId, nodeId, depth)
    return context.json(snapshot, 200)
  })

  return router
}
