import type { WorkspaceRepository } from '@braidhq/core'
import type { AbsolutePath } from '@braidhq/schema'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { NotFoundError } from '@braidhq/core'
import { SourceId } from '@braidhq/schema'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { getWorkspaceId } from '../middleware/workspaceId.js'
import { NotFoundResponse, WorkspaceIdParam } from './_shared.js'
import { loadWorkspaceById } from './helpers.js'

// A window either side of the cited range, so a reader sees the line in its
// own context instead of a fragment with no surroundings.
const CONTEXT_LINES = 4
// A cited range is evidence, not a file viewer. Anything larger than this is
// a sign the reference is too broad to read inline anyway.
const MAX_LINES = 200

export interface SourceExcerptRouterDeps {
  readonly workspaceRepository: WorkspaceRepository
}

const ExcerptBody = z.object({
  sourceId: SourceId,
  uri: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
}).openapi('SourceExcerptRequest')

const ExcerptResponse = z.object({
  /** Line number of the first returned line, so a renderer can number them. */
  firstLine: z.number().int().positive(),
  lines: z.array(z.string()),
  /** Where the cited range sits inside `lines`, for highlighting. */
  highlightFrom: z.number().int().nonnegative(),
  highlightTo: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).openapi('SourceExcerptResponse')

const excerptRoute = createRoute({
  method: 'post',
  path: '/excerpt',
  operationId: 'readSourceExcerpt',
  summary: 'Read the cited lines from the local mirror of a source.',
  tags: ['sources'],
  request: {
    params: WorkspaceIdParam,
    body: { content: { 'application/json': { schema: ExcerptBody } }, required: true },
  },
  responses: {
    200: {
      description: 'The cited lines, with a little context either side.',
      content: { 'application/json': { schema: ExcerptResponse } },
    },
    404: NotFoundResponse,
  },
})

/**
 * The local copy of a cited location, for reading in place.
 *
 * Distinct from the canonical link, which leaves for the host. This is the
 * mirror already on disk, which is what a reader wants while reading rather
 * than acting, and it is the only one that works for a source with no host.
 */
export function createSourceExcerptRouter(deps: SourceExcerptRouterDeps): OpenAPIHono {
  const router = new OpenAPIHono()

  router.openapi(excerptRoute, async (context) => {
    const workspace = await loadWorkspaceById(getWorkspaceId(context), deps.workspaceRepository)
    const { sourceId, uri, startLine, endLine } = context.req.valid('json')

    const source = workspace.sources.find(candidate => candidate.id === sourceId)
    if (!source || source.kind !== 'filesystem')
      throw new NotFoundError(`Source "${sourceId}" not found`)

    const sourceRoot = resolveWithin(source.path, workspace.rootPath)
    const target = resolveWithin(uri, workspace.rootPath)
    // A reference names a place inside its own source. Anything else is a
    // path traversal, whether or not whoever wrote it meant one.
    if (relative(sourceRoot, target).startsWith('..'))
      throw new NotFoundError(`Reference "${uri}" is outside source "${sourceId}"`)

    const content = await readFile(target, 'utf8').catch(() => null)
    if (content === null)
      throw new NotFoundError(`Reference "${uri}" is not in this workspace's mirror`)

    const all = content.split('\n')
    const from = Math.max(1, (startLine ?? 1) - CONTEXT_LINES)
    const to = Math.min(all.length, (endLine ?? startLine ?? all.length) + CONTEXT_LINES)
    const capped = Math.min(to, from + MAX_LINES - 1)

    return context.json({
      firstLine: from,
      lines: all.slice(from - 1, capped),
      highlightFrom: startLine === undefined ? 0 : startLine - from,
      highlightTo: startLine === undefined ? 0 : (endLine ?? startLine) - from,
      truncated: capped < to,
    }, 200)
  })

  return router
}

function resolveWithin(path: string, rootPath: AbsolutePath): AbsolutePath {
  return (isAbsolute(path) ? path : resolve(rootPath, path)) as AbsolutePath
}
