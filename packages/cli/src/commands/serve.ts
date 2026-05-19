import process from 'node:process'
import { composeFsApp, createApp } from '@braidhq/server'
import { serve } from '@hono/node-server'
import pc from 'picocolors'

export interface ServeCommandInput {
  readonly port: number
}

/**
 * Boot the Braid server in-process. Same wiring as
 * `packages/server/src/server.ts` but reachable from a single CLI binary.
 * Reads BRAID_HOME / BRAID_AGENT_* env vars so existing deployment
 * scripts keep working; CLI flags only add a port override for now.
 */
export async function serveCommand(input: ServeCommandInput): Promise<void> {
  const port = input.port
  const deps = await composeFsApp({
    apiUrl: `http://localhost:${port}`,
    ...(process.env.BRAID_HOME ? { braidHome: process.env.BRAID_HOME } : {}),
    ...(process.env.BRAID_AGENT_MODEL ? { agentModel: process.env.BRAID_AGENT_MODEL } : {}),
    ...(process.env.BRAID_AGENT_EFFORT ? { agentEffort: process.env.BRAID_AGENT_EFFORT as never } : {}),
  })
  const app = createApp(deps)

  await new Promise<void>((resolveBoot) => {
    serve({ fetch: app.fetch, port }, ({ port: boundPort }) => {
      process.stdout.write(`${pc.green('✓')} braid-server listening on ${pc.cyan(`http://localhost:${boundPort}`)}\n`)
      resolveBoot()
    })
  })
}
