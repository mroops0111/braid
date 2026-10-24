import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { loadRootEnv, startServer } from '@braidhq/server'
import { studioAssetsDir } from '@braidhq/studio/assets'
import pc from 'picocolors'

export interface StartCommandInput {
  readonly port: number
}

/**
 * Boot the server with Studio's built files on the same origin, the one command a fresh install needs.
 * It does what the container does, from the published packages instead of an image.
 * Env the caller already set wins, so a deployment can still name its own Studio files or its own origin.
 */
export async function startCommand(input: StartCommandInput): Promise<void> {
  loadRootEnv()
  const studioRoot = process.env.BRAID_STUDIO_ROOT ?? studioAssetsDir
  if (!existsSync(join(studioRoot, 'index.html')))
    throw new Error(`No built Studio at ${studioRoot}. In a checkout, run "pnpm build" first, or use "braid dev".`)
  process.env.BRAID_STUDIO_ROOT = studioRoot
  // Studio is served from this port, so it is also the origin CORS and the sign-in redirects name.
  process.env.BRAID_STUDIO_URL ??= `http://localhost:${input.port}`
  await startServer({
    port: input.port,
    onListen: url => process.stdout.write(`${pc.green('✓')} Braid Studio at ${pc.cyan(url)}\n`),
  })
}
