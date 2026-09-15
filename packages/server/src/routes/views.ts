import type { SkillRegistry, ViewService, WorkspaceRepository } from '@braidhq/core'
import { GeneratedView, GenerateViewRequest, GenerateViewResponse, ListViewsResponse, ViewContent } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { extractBearerToken, getUserId } from '../middleware/auth.js'
import { requirePermission } from '../middleware/workspaceAccess.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { ConflictResponse, NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

export interface ViewsRouterDeps {
  viewService: ViewService
  skillRegistry: SkillRegistry
  workspaceRepository: WorkspaceRepository
}

/**
 * A view is asked for by its three parts rather than by one opaque string.
 *
 * Each segment is its own parameter,
 * so a name carrying a separator cannot be read as a directory of its own,
 * and the router refuses it before any handler sees it.
 */
const ViewPathParam = WorkspaceIdParam.extend({
  kind: GeneratedView.shape.kind.openapi({ param: { name: 'kind', in: 'path' } }),
  form: GeneratedView.shape.form.openapi({ param: { name: 'form', in: 'path' } }),
  name: z.string().min(1).openapi({
    param: { name: 'name', in: 'path' },
    description: 'The file name, which is the subject node id escaped, plus the format as an extension.',
  }),
})

const listRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'listViews',
  summary: 'List the documents written out of this workspace.',
  description: 'One entry per written view, with the subject it was written out of and whether the graph has moved on since.',
  tags: ['views'],
  request: { params: WorkspaceIdParam },
  responses: {
    200: {
      description: 'The documents this workspace holds.',
      content: { 'application/json': { schema: ListViewsResponse } },
    },
  },
})

const readRoute = createRoute({
  method: 'get',
  path: '/{kind}/{form}/{name}',
  operationId: 'readView',
  summary: 'Read one written document.',
  description: 'The blocks the run rendered, in the order it rendered them, with the format the form declares it writes.',
  tags: ['views'],
  request: { params: ViewPathParam },
  responses: {
    200: {
      description: 'The document.',
      content: { 'application/json': { schema: ViewContent } },
    },
    404: NotFoundResponse,
  },
})

const generateRoute = createRoute({
  method: 'post',
  path: '/',
  operationId: 'generateView',
  summary: 'Write a document out of one subject, in one form.',
  description: 'Projects the subject into material, then starts the form\'s skill on it. Writing takes a minute or so, so the run is handed back to watch rather than waited on.',
  tags: ['views'],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: GenerateViewRequest } } },
  },
  responses: {
    202: {
      description: 'The run writing the document.',
      content: { 'application/json': { schema: GenerateViewResponse } },
    },
    400: ValidationFailureResponse,
    404: NotFoundResponse,
    409: ConflictResponse,
  },
})

export function createViewsRouter(deps: ViewsRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  // Writing a document is the form's skill run on a projected subject,
  // so whoever may run that skill may write one, and nobody else.
  // Reading is left open, since a document is a reading of the graph,
  // and anybody who may read the graph may read what was written out of it.
  // The resource builder refuses an unknown kind or form the way `generate`
  // does, so a bad request is still answered as a bad request.
  router.on('POST', '/', requirePermission('skill.run', async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const body = GenerateViewRequest.parse(await context.req.json())
    const skillId = deps.viewService.skillIdFor(body.kind, body.form)
    const manifest = await deps.skillRegistry.get(workspace, skillId)
    return { skill: manifest.toData().frontmatter, skillId }
  }))

  router.openapi(listRoute, async (context) => {
    const items = await deps.viewService.list(getWorkspaceId(context))
    return context.json({ items: [...items] }, 200)
  })

  router.openapi(readRoute, async (context) => {
    const { kind, form, name } = context.req.valid('param')
    const content = await deps.viewService.read(getWorkspaceId(context), `${kind}/${form}/${name}`)
    return context.json(content, 200)
  })

  router.openapi(generateRoute, async (context) => {
    const { kind, form, subject, asked } = context.req.valid('json')
    const callerToken = extractBearerToken(context)
    const started = await deps.viewService.generate({
      workspaceId: getWorkspaceId(context),
      kind,
      form,
      subject,
      asked: asked ?? {},
      // Attribute the run to whoever asked for it,
      // since one workspace's run history is shared by every member.
      startedBy: getUserId(context),
      ...(callerToken ? { callerToken } : {}),
    })
    return context.json(started, 202)
  })

  return router
}
