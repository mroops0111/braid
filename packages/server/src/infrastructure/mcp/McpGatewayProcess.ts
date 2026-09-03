import type { ChildProcess } from 'node:child_process'
import type { SpawnFn } from '../skill/SubprocessSkillRunner.js'
import type { McpGatewayConfigDocument } from './gatewayConfig.js'
import { writeFile } from 'node:fs/promises'
import { stringify } from 'yaml'

// Backoff between restarts, doubling from the first up to the cap.
// A gateway that cannot reach its authorization server fails in milliseconds,
// so a flat retry would spin the CPU on a config mistake.
const FIRST_RESTART_DELAY_MS = 1_000
const MAX_RESTART_DELAY_MS = 30_000

export interface McpGatewayProcessDeps {
  /** Resolved `uvx`, the same binary the per-run gateway uses. */
  readonly uvxBin: string
  /** Where the generated config lands, rewritten on every start. */
  readonly configPath: string
  readonly config: McpGatewayConfigDocument
  /**
   * What `uvx` resolves the gateway from.
   * Carries the `oidc` extra, which is what token_exchange needs,
   * and lets a deployment pin a version or point at a pre-release.
   */
  readonly gatewayPackage: string
  readonly spawn?: SpawnFn
  readonly delay?: (milliseconds: number) => Promise<void>
  readonly log?: (message: string) => void
}

/**
 * Supervises the long-lived `openapi-mcp-gateway`,
 * which serves Braid's read-only MCP endpoint over streamable-http.
 *
 * Distinct from the per-run gateway in `SubprocessSkillRunner`,
 * which speaks stdio and lives only as long as one agent invocation.
 * This one outlives every run,
 * because the caller is a person's own MCP client, not a skill Braid spawned.
 */
export class McpGatewayProcess {
  private child: ChildProcess | null = null
  private stopped = false
  private supervising: Promise<void> | null = null

  constructor(private readonly deps: McpGatewayProcessDeps) {}

  /**
   * Writes the config, then supervises the process in the background.
   * Resolves once the first spawn is under way,
   * so boot is not held behind a service the server does not depend on.
   */
  async start(): Promise<void> {
    await writeFile(this.deps.configPath, stringify(this.deps.config), 'utf8')
    this.supervising = this.supervise()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.child?.kill('SIGTERM')
    await this.supervising
  }

  private async supervise(): Promise<void> {
    const spawnFn = this.deps.spawn ?? (await defaultSpawn())
    const log = this.deps.log ?? ((message: string) => console.warn(message))
    const delay = this.deps.delay ?? defaultDelay
    let restartDelay = FIRST_RESTART_DELAY_MS
    while (!this.stopped) {
      const exit = await this.runOnce(spawnFn)
      if (this.stopped)
        return
      log(
        `[braid] The MCP gateway exited (${exit}). Restarting in ${restartDelay}ms. `
        + `Its config is at ${this.deps.configPath}.`,
      )
      await delay(restartDelay)
      restartDelay = Math.min(restartDelay * 2, MAX_RESTART_DELAY_MS)
    }
  }

  private runOnce(spawnFn: SpawnFn): Promise<string> {
    return new Promise((resolve) => {
      const child = spawnFn(
        this.deps.uvxBin,
        ['--from', this.deps.gatewayPackage, 'openapi-mcp-gateway', '--config', this.deps.configPath],
        // The child inherits this process's env,
        // which is where the config's `${...}` credential references resolve.
        // Keeping them there leaves the file readable without being a secret.
        { stdio: ['ignore', 'inherit', 'inherit'] },
      )
      this.child = child
      child.once('error', (error: Error) => resolve(`could not spawn: ${error.message}`))
      child.once('exit', (code, signal) => resolve(signal ? `signal ${signal}` : `code ${code}`))
    })
  }
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function defaultSpawn(): Promise<SpawnFn> {
  const { spawn } = await import('node:child_process')
  return spawn as unknown as SpawnFn
}
