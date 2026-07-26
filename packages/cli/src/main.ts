import { createRequire } from 'node:module'
import process from 'node:process'
import { cac } from 'cac'
import pc from 'picocolors'
import { devCommand } from './commands/dev.js'
import { initCommand } from './commands/init.js'
import { serveCommand } from './commands/serve.js'
import { workspaceListCommand } from './commands/workspace.js'

// Read from package.json so `braid --version` never drifts from the release.
const { version: VERSION } = createRequire(import.meta.url)('../package.json') as { version: string }

const cli = cac('braid')

cli
  .command('init <dir>', 'Scaffold a new Braid workspace')
  .option('--ontology <id>', 'Ontology id for the workspace (defaults to ddd)', { default: 'ddd' })
  .option('--name <name>', 'Workspace name (defaults to the directory basename)')
  .option('--force', 'Overwrite if the directory already has a PRODUCT.md')
  .action(async (dir: string, flags: { ontology: string, name?: string, force?: boolean }) => {
    await initCommand({
      dir,
      ontologyId: flags.ontology,
      ...(flags.name ? { name: flags.name } : {}),
      ...(flags.force ? { force: flags.force } : {}),
    })
  })

cli
  .command('serve', 'Run the Braid server')
  .option('--port <port>', 'TCP port to bind (default 4321)', { default: 4321 })
  .action(async (flags: { port: number }) => {
    await serveCommand({ port: Number(flags.port) })
  })

cli
  .command('dev', 'Run server + Studio together (Vite + Hono)')
  .option('--port <port>', 'Server port (Studio always on 5173)', { default: 4321 })
  .action(async (flags: { port: number }) => {
    await devCommand({ port: Number(flags.port) })
  })

cli
  .command('workspace list', 'List workspaces registered with a running server')
  .option('--api <url>', 'Server URL (default http://localhost:4321)', { default: 'http://localhost:4321' })
  .action(async (flags: { api: string }) => {
    await workspaceListCommand({ apiUrl: flags.api })
  })

cli.help()
cli.version(VERSION)

try {
  cli.parse(process.argv, { run: false })
  await cli.runMatchedCommand()
}
catch (error) {
  // Surface user-facing errors without stack traces. Reserve stacks for bugs.
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${pc.red('error')} ${message}\n`)
  process.exit(1)
}
