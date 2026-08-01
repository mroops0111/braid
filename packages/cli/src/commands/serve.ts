import process from 'node:process'
import { loadRootEnv, startServer } from '@braidhq/server'
import pc from 'picocolors'

export interface ServeCommandInput {
  readonly port: number
}

/**
 * Boot the Braid server from a single CLI binary.
 * Shares `startServer` with `packages/server/src/server.ts`,
 * so env loading, graceful shutdown, and background recovery match.
 * CLI flags only add a port override for now.
 */
export async function serveCommand(input: ServeCommandInput): Promise<void> {
  loadRootEnv()
  await startServer({
    port: input.port,
    onListen: url => process.stdout.write(`${pc.green('✓')} braid-server listening on ${pc.cyan(url)}\n`),
  })
}
