import type { AgentEffort } from '@telos/schema'
import process from 'node:process'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { composeFsApp } from './composeFs.js'
import { reapOrphanRuns } from './infrastructure/orphanReaper.js'

const port = Number(process.env.TELOS_SERVER_PORT ?? 4321)
const deps = composeFsApp({
  apiUrl: `http://localhost:${port}`,
  ...(process.env.TELOS_HOME ? { telosHome: process.env.TELOS_HOME } : {}),
  ...(process.env.TELOS_AGENT_MODEL ? { agentModel: process.env.TELOS_AGENT_MODEL } : {}),
  ...(process.env.TELOS_AGENT_EFFORT ? { agentEffort: process.env.TELOS_AGENT_EFFORT as AgentEffort } : {}),
})

const app = createApp(deps)

serve({ fetch: app.fetch, port }, ({ port: boundPort }) => {
  // eslint-disable-next-line no-console
  console.log(`telos-server listening on http://localhost:${boundPort}`)
})

// Any run without a `completedAt` is from a previous server process that was
// killed mid-run. Tag those as aborted so they don't appear "active forever"
// in the Runs UI. Run after `serve()` so it doesn't delay accepting requests.
reapOrphanRuns({
  workspaceRepository: deps.workspaceRepository,
  runRepository: deps.runRepository,
  clock: deps.clock,
}).then(({ reaped }) => {
  if (reaped > 0) {
    // eslint-disable-next-line no-console
    console.log(`telos-server: marked ${reaped} orphan run(s) as aborted`)
  }
}).catch((error) => {
  console.error('orphan reaper failed:', error)
})
