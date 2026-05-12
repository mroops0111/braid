import { Hono } from 'hono'

export const healthRouter = new Hono()

healthRouter.get('/', (context) => {
  return context.json({
    status: 'ok',
    service: 'telos-server',
    timestamp: new Date().toISOString(),
  })
})
