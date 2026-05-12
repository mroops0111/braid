import process from 'node:process'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { composeApp } from './composition.js'

const port = Number(process.env.TELOS_SERVER_PORT ?? 4321)
const app = createApp(composeApp())

serve({ fetch: app.fetch, port }, ({ port: boundPort }) => {
  // eslint-disable-next-line no-console
  console.log(`telos-server listening on http://localhost:${boundPort}`)
})
