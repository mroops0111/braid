import type { AgentEffort } from '@braidhq/schema'
import process from 'node:process'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { composeFsApp } from './composeFs.js'
import { reapOrphanRuns } from './infrastructure/orphanReaper.js'

async function main(): Promise<void> {
  const port = Number(process.env.BRAID_SERVER_PORT ?? 4321)
  const deps = await composeFsApp({
    apiUrl: `http://localhost:${port}`,
    ...(process.env.BRAID_HOME ? { braidHome: process.env.BRAID_HOME } : {}),
    ...(process.env.BRAID_AGENT_MODEL ? { agentModel: process.env.BRAID_AGENT_MODEL } : {}),
    ...(process.env.BRAID_AGENT_EFFORT ? { agentEffort: process.env.BRAID_AGENT_EFFORT as AgentEffort } : {}),
  })

  const app = createApp(deps)

  serve({ fetch: app.fetch, port }, ({ port: boundPort }) => {
    // eslint-disable-next-line no-console
    console.log(`braid-server listening on http://localhost:${boundPort}`)
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
      console.log(`braid-server: marked ${reaped} orphan run(s) as aborted`)
    }
  }).catch((error) => {
    console.error('orphan reaper failed:', error)
  })
}

main().catch((error) => {
  console.error('braid-server failed to start:', error)
  process.exit(1)
})
