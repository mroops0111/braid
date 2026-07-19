import type { AppDependencies } from './composeApp.js'
import type { ComposeFsOptions } from './composeFsApp.js'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { createLogger } from '@braidhq/core'
import { AgentEffort } from '@braidhq/schema'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { composeFsApp } from './composeFsApp.js'
import { startupAfterServe } from './startup.js'

// Walk up from the working directory to the first `.env`, and load it,
// before anything reads process.env.
// A missing file is silent, production boots from real env, not dotfiles.
export function loadRootEnv(): void {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, '.env')
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate)
      return
    }
    const parent = dirname(dir)
    if (parent === dir)
      return
    dir = parent
  }
}

// The server's own env vars, read in one place so both entries agree.
// Each key is an optional override, an unset var falls to the preset default.
function fsOptionsFromEnv(): ComposeFsOptions {
  return {
    ...(process.env.BRAID_HOME ? { braidHome: process.env.BRAID_HOME } : {}),
    ...(process.env.BRAID_AGENT_MODEL ? { agentModel: process.env.BRAID_AGENT_MODEL } : {}),
    ...(process.env.BRAID_AGENT_EFFORT ? { agentEffort: AgentEffort.parse(process.env.BRAID_AGENT_EFFORT) } : {}),
  }
}

export interface StartServerOptions {
  readonly port: number
  // Called once the socket is listening, with the bound URL.
  readonly onListen?: (url: string) => void
}

// Boot the coding-preset app and start serving, shared by the standalone
// entry and the cli `serve` command so both wire identically.
// Resolves once the socket is listening, then keeps running under signal handlers.
export async function startServer(options: StartServerOptions): Promise<void> {
  const apiUrl = `http://localhost:${options.port}`
  const deps = await composeFsApp({ apiUrl, ...fsOptionsFromEnv() })
  const app = createApp(deps, { apiUrl })
  const log = createLogger('server')

  const server = await new Promise<ReturnType<typeof serve>>((resolveBoot) => {
    const handle = serve({ fetch: app.fetch, port: options.port }, ({ port }) => {
      options.onListen?.(`http://localhost:${port}`)
      resolveBoot(handle)
    })
  })

  installShutdown(server, deps, log)
  // Background recovery, after serve() so it never delays accepting requests.
  void startupAfterServe(deps)
}

// Close the model repository on shutdown so the storage adapter flushes cleanly.
// Second signal force-quits in case close hangs.
function installShutdown(
  server: ReturnType<typeof serve>,
  deps: AppDependencies,
  log: ReturnType<typeof createLogger>,
): void {
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
}
