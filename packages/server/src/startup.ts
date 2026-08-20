import type { AppDependencies } from './composeApp.js'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { createLogger } from '@braidhq/core'
import { reapOrphanRuns } from './infrastructure/skill/orphanReaper.js'

/**
 * The blocking startup pass, run once after composition,
 * before the server accepts requests.
 * Per workspace it provisions the git repo and store,
 * recovers in-flight state left by a killed process,
 * subscribes the reactor when the workspace opts in,
 * and fires a catch-up sync for missed webhook deliveries.
 *
 * This is the single home for per-workspace boot steps.
 * A new one is added here,
 * not scattered across composition and the server entry.
 * Recovery that need not finish before serving,
 * such as reaping orphan runs, runs after `serve()` in `server.ts`,
 * so it never delays accepting requests.
 *
 * Per-workspace failures are logged and tolerated,
 * so one bad directory does not block the rest of the boot.
 */
export async function startupBeforeServe(deps: AppDependencies): Promise<void> {
  const log = createLogger('server').child({ mod: 'workspace-startup' })
  for (const workspace of await deps.workspaceService.list()) {
    try {
      await deps.bootstrap?.ensure(workspace)
      // Mark any batch plan left running by a previous process as failed,
      // so the UI does not show a phantom spinner.
      // Safe when there is no plan, or when it is already terminal.
      await deps.batchService?.reconcileAfterBoot(workspace.id)
      // Reactor opt-in is per workspace, subscribe only when PRODUCT.md sets it.
      if (workspace.productManifest.reactor?.enabled)
        await deps.reactorService?.start(workspace.id)
      // Warms sources between reads. The freshness check at read time is what
      // guarantees the budget, so a workspace that opts out of polling is
      // slower on first use, never staler.
      if (workspace.productManifest.polling?.enabled !== false)
        await deps.sourcePollingService.start(workspace.id, workspace)
      // Catch deliveries missed while the server was down.
      // GitHub drops webhook retries after a few hours,
      // so every boot fires one syncOne per loader source.
      // Loaders carry a persisted cursor,
      // so a caught-up source costs one empty round trip,
      // a stale one fetches only the missed window.
      // Fire-and-forget keeps boot fast, the reactor picks up the events.
      for (const source of workspace.sources) {
        if (source.kind !== 'filesystem' || !source.loader)
          continue
        void deps.sourceSyncService.syncNow(workspace, source.id).catch((err) => {
          log.warn(
            { workspaceId: workspace.id, sourceId: source.id, err: err instanceof Error ? err.message : String(err) },
            'boot syncOne failed, will retry on next webhook or manual sync',
          )
        })
      }
    }
    catch (err) {
      log.warn({ err, workspaceId: workspace.id }, 'workspace startup failed, skipping')
    }
  }
}

/**
 * The background startup pass, run once after `serve()`,
 * so it never delays accepting requests.
 * Cosmetic recovery that need not finish before the first request lives here,
 * not in the blocking `startupBeforeServe`.
 */
export async function startupAfterServe(deps: AppDependencies): Promise<void> {
  const log = createLogger('server').child({ mod: 'workspace-startup' })
  try {
    const { reaped } = await reapOrphanRuns({
      workspaceRepository: deps.workspaceRepository,
      runRepository: deps.runRepository,
      clock: deps.clock,
    })
    if (reaped > 0)
      log.info({ reaped }, `marked ${reaped} orphan run(s) as aborted`)
  }
  catch (err) {
    log.error({ err }, 'orphan reaper failed')
  }

  // Warm the MCP gateway package so the first skill run's braid-core connects
  // fast, rather than paying the uvx cold-start mid-conversation.
  warmGateway()
}

// Pre-fetch the openapi-mcp-gateway package, the download that otherwise makes
// braid-core look slow to connect on the first run. Fire-and-forget and
// unref'd, a warm cache is best-effort and never gates the boot. A 30s kill
// guards a `--help` that hangs once the package is cached, and a missing uvx
// just errors out quietly. This lives in the after-serve pass, not composition,
// so it stays out of tests that build the app directly.
function warmGateway(): void {
  const uvxBin = process.env.BRAID_UVX_BIN || 'uvx'
  const child = spawn(uvxBin, ['openapi-mcp-gateway', '--help'], { stdio: 'ignore' })
  child.once('error', () => {})
  child.unref()
  const timer = setTimeout(() => child.kill(), 30_000)
  timer.unref()
  child.once('exit', () => clearTimeout(timer))
}
