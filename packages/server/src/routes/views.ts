import type { ViewService } from '@braidhq/core'
import { GeneratedView, GenerateViewRequest, GenerateViewResponse, ListViewsResponse, ViewContent } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { extractBearerToken, getUserId } from '../middleware/auth.js'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { ConflictResponse, NotFoundResponse, ValidationFailureResponse, WorkspaceIdParam } from './_shared.js'

export interface ViewsRouterDeps {
  viewService: ViewService
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
