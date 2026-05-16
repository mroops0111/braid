import { Hono } from 'hono'

export const healthRouter = new Hono()

healthRouter.get('/', (context) => {
  return context.json({
    status: 'ok',
    service: 'braid-server',
    timestamp: new Date().toISOString(),
  })
})
