import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.literal('braid-server'),
  timestamp: z.string(),
}).openapi('HealthResponse')

const healthRoute = createRoute({
  method: 'get',
  path: '/',
  operationId: 'health',
  summary: 'Liveness probe',
  tags: ['health'],
  responses: {
    200: {
      description: 'Server is up.',
      content: { 'application/json': { schema: HealthResponse } },
    },
  },
})

export const healthRouter = new OpenAPIHono()

healthRouter.openapi(healthRoute, (context) => {
  return context.json({
    status: 'ok' as const,
    service: 'braid-server' as const,
    timestamp: new Date().toISOString(),
  })
})
