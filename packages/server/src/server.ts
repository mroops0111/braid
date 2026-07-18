import type { AgentEffort } from '@braidhq/schema'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@braidhq/core'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { composeFsApp } from './composeFsApp.js'
import { startupAfterServe } from './startup.js'

// Load .env from the monorepo root, where pnpm-workspace.yaml lives,
// before anything reads process.env.
// A missing file is silent, production boots from real env, not dotfiles.
{
  const here = dirname(fileURLToPath(import.meta.url))
  // src/server.ts sits in packages/server/src, so the root is ../../../.env.
  const candidates = [resolve(here, '../../../.env'), resolve(process.cwd(), '.env')]
  for (const path of candidates) {
    if (existsSync(path)) {
      process.loadEnvFile(path)
      break
    }
  }
}

const log = createLogger('server')

async function main(): Promise<void> {
  const port = Number(process.env.BRAID_SERVER_PORT ?? 4321)
  const apiUrl = `http://localhost:${port}`
  const deps = await composeFsApp({
    apiUrl,
    ...(process.env.BRAID_HOME ? { braidHome: process.env.BRAID_HOME } : {}),
    ...(process.env.BRAID_AGENT_MODEL ? { agentModel: process.env.BRAID_AGENT_MODEL } : {}),
    ...(process.env.BRAID_AGENT_EFFORT ? { agentEffort: process.env.BRAID_AGENT_EFFORT as AgentEffort } : {}),
  })

  const app = createApp(deps, { apiUrl })

  const server = serve({ fetch: app.fetch, port }, ({ port: boundPort }) => {
    log.info({ port: boundPort }, `listening on http://localhost:${boundPort}`)
  })

  // Close the model repository on shutdown so Kuzu flushes its WAL.
  // Second signal force-quits in case close hangs.
  let shuttingDown = false
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      log.warn({ signal }, 'received second shutdown signal, exiting now')
      process.exit(1)
    }
    shuttingDown = true
    log.info({ signal }, 'shutting down')
    server.close()
    try {
      await deps.modelRepository.close?.()
    }
    catch (err) {
      log.error({ err }, 'modelRepository.close failed')
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  // Background recovery, after serve() so it never delays accepting requests.
  void startupAfterServe(deps)
}

main().catch((error) => {
  log.error({ err: error }, 'failed to start')
  process.exit(1)
})
