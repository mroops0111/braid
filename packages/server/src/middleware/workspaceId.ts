import type { WorkspaceId as WorkspaceIdType } from '@braidhq/schema'
import type { Context, MiddlewareHandler } from 'hono'
import { WorkspaceId } from '@braidhq/schema'

declare module 'hono' {
  interface ContextVariableMap {
    workspaceId: WorkspaceIdType
  }
}

export const workspaceIdMiddleware: MiddlewareHandler = async (context, next) => {
  context.set('workspaceId', WorkspaceId.parse(context.req.param('workspaceId')))
  await next()
}

export function getWorkspaceId(context: Context): WorkspaceIdType {
  return context.get('workspaceId')
}
