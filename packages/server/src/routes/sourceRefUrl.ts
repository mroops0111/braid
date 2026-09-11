import type { PluginRegistry, SourceSyncStateRepository, WorkspaceRepository } from '@braidhq/core'
import type { AbsolutePath } from '@braidhq/schema'
import { isAbsolute, relative, resolve } from 'node:path'
import { SourceId, SourceLocation } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

export interface SourceRefUrlRouterDeps {
  readonly workspaceRepository: WorkspaceRepository
  readonly pluginRegistry: PluginRegistry
  readonly sourceSyncStateRepository: SourceSyncStateRepository
}

const ResolveBody = z.object({
  sourceId: SourceId,
  location: SourceLocation,
}).openapi('SourceRefUrlRequest')

/**
 * `url` is null whenever the source cannot be addressed on a host,
 * which is the normal answer for a local directory rather than an error.
 */
const ResolveResponse = z.object({
  url: z.string().url().nullable(),
}).openapi('SourceRefUrlResponse')

const resolveRoute = createRoute({
  method: 'post',
  path: '/resolve',
  operationId: 'resolveSourceRefUrl',
  summary: 'Resolve a source reference to a URL on the host it came from.',
  tags: ['sources'],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: ResolveBody } }, required: true },
  },
  responses: {
    200: {
      description: 'The canonical URL, or null when this source has no web address.',
      content: { 'application/json': { schema: ResolveResponse } },
    },
    404: NotFoundResponse,
  },
})

/**
 * Turns a reference into a link on the host its source came from.
 *
 * The framework never parses what a loader returns,
 * and never learns that any particular host exists,
 * which is what keeps a new host a plugin change rather than a change here.
 */
export function createSourceRefUrlRouter(deps: SourceRefUrlRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(resolveRoute, async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const { sourceId, location } = context.req.valid('json')

    const source = workspace.sources.find(candidate => candidate.id === sourceId)
    if (!source || source.kind !== 'filesystem' || !source.loader)
      return context.json({ url: null }, 200)

    const loader = deps.pluginRegistry.findSourceLoader(source.loader.kind)
    if (!loader?.webUrlFor)
      return context.json({ url: null }, 200)

    // A descriptor's path may be written relative to the workspace,
    // so it is resolved before anything compares it against a reference.
    const destination = resolveWithin(source.path, workspace.rootPath)
    // A ref's uri is workspace-relative,
    // while a loader addresses paths from its own root,
    // so the source's own directory is subtracted first.
    const unitPath = toUnitPath(location.uri, destination, workspace.rootPath)
    const state = await deps.sourceSyncStateRepository.find(workspace.id, sourceId)

    const url = await loader.webUrlFor({
      config: source.loader.config,
      unitPath,
      location,
      destination,
      ...(state?.revision ? { revision: state.revision } : {}),
    })
    return context.json({ url: url ?? null }, 200)
  })

  return router
}

function resolveWithin(path: string, rootPath: AbsolutePath): AbsolutePath {
  return (isAbsolute(path) ? path : resolve(rootPath, path)) as AbsolutePath
}

function toUnitPath(uri: string, sourcePath: AbsolutePath, rootPath: AbsolutePath): string {
  const absolute = isAbsolute(uri) ? uri : resolve(rootPath, uri)
  const withinSource = relative(sourcePath, absolute)
  // A ref outside the source is passed through rather than escaped upward,
  // so a loader sees a path it can reject instead of one that climbs out.
  return withinSource.startsWith('..') ? uri.replace(/^\/+/, '') : withinSource
}
