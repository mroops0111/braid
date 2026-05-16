import process from 'node:process'
import { serve } from '@hono/node-server'
import { composeFsApp, createApp } from '@telos/server'
import pc from 'picocolors'

export interface ServeCommandInput {
  readonly port: number
}

/**
 * Boot the Telos server in-process. Same wiring as
 * `packages/server/src/server.ts` but reachable from a single CLI binary.
 * Reads TELOS_HOME / TELOS_AGENT_* env vars so existing deployment
 * scripts keep working; CLI flags only add a port override for now.
 */
export async function serveCommand(input: ServeCommandInput): Promise<void> {
  const port = input.port
  const deps = composeFsApp({
    apiUrl: `http://localhost:${port}`,
    ...(process.env.TELOS_HOME ? { telosHome: process.env.TELOS_HOME } : {}),
    ...(process.env.TELOS_AGENT_MODEL ? { agentModel: process.env.TELOS_AGENT_MODEL } : {}),
    ...(process.env.TELOS_AGENT_EFFORT ? { agentEffort: process.env.TELOS_AGENT_EFFORT as never } : {}),
  })
  const app = createApp(deps)

  await new Promise<void>((resolveBoot) => {
    serve({ fetch: app.fetch, port }, ({ port: boundPort }) => {
      process.stdout.write(`${pc.green('✓')} telos-server listening on ${pc.cyan(`http://localhost:${boundPort}`)}\n`)
      resolveBoot()
    })
  })
}
