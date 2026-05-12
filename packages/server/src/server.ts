import type { AgentEffort } from '@telos/schema'
import process from 'node:process'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { composeFsApp } from './composeFs.js'

const port = Number(process.env.TELOS_SERVER_PORT ?? 4321)
const app = createApp(composeFsApp({
  apiUrl: `http://localhost:${port}`,
  ...(process.env.TELOS_HOME ? { telosHome: process.env.TELOS_HOME } : {}),
  ...(process.env.TELOS_AGENT_MODEL ? { agentModel: process.env.TELOS_AGENT_MODEL } : {}),
  ...(process.env.TELOS_AGENT_EFFORT ? { agentEffort: process.env.TELOS_AGENT_EFFORT as AgentEffort } : {}),
}))

serve({ fetch: app.fetch, port }, ({ port: boundPort }) => {
  // eslint-disable-next-line no-console
  console.log(`telos-server listening on http://localhost:${boundPort}`)
})
