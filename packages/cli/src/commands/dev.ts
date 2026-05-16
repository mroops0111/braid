import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import pc from 'picocolors'
import { serveCommand } from './serve.js'

export interface DevCommandInput {
  readonly port: number
}

/**
 * Boot Telos for interactive development.
 *
 * Two modes, chosen automatically:
 *
 *   - **Monorepo mode** (a `pnpm-workspace.yaml` exists at CWD or any
 *     ancestor): spawn `pnpm --filter @telos/server dev` and
 *     `pnpm --filter @telos/studio dev` as child processes so changes
 *     to either reload live. Logs are prefixed `[server]` / `[studio]`
 *     and routed to this CLI's stdout. Ctrl+C kills both.
 *
 *   - **Standalone mode** (no pnpm workspace context): just runs
 *     `serveCommand`. Studio is not started; v0.1 doesn't ship a
 *     bundled Studio dist for standalone installs yet (see roadmap).
 */
export async function devCommand(input: DevCommandInput): Promise<void> {
  const monorepoRoot = await findMonorepoRoot(process.cwd())
  if (!monorepoRoot) {
    process.stdout.write(
      `${pc.yellow('!')} No pnpm workspace detected; running server only.\n`
      + `  To run Studio too, clone https://github.com/mroops0111/telos and "pnpm dev" from there.\n\n`,
    )
    await serveCommand({ port: input.port })
    return
  }
  await runMonorepoDev(monorepoRoot, input.port)
}

async function findMonorepoRoot(start: string): Promise<string | undefined> {
  let dir = resolve(start)
  while (true) {
    if (await fileExists(`${dir}/pnpm-workspace.yaml`))
      return dir
    const parent = resolve(dir, '..')
    if (parent === dir)
      return undefined
    dir = parent
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

interface ChildSpec {
  readonly tag: string
  readonly color: (s: string) => string
  readonly args: readonly string[]
}

async function runMonorepoDev(cwd: string, port: number): Promise<void> {
  const specs: readonly ChildSpec[] = [
    { tag: 'server', color: pc.cyan, args: ['--filter', '@telos/server', 'dev'] },
    { tag: 'studio', color: pc.magenta, args: ['--filter', '@telos/studio', 'dev'] },
  ]
  const children: ChildProcess[] = []
  for (const spec of specs) {
    const child = spawn('pnpm', [...spec.args], {
      cwd,
      env: { ...process.env, TELOS_SERVER_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    pipeWithPrefix(child, spec.tag, spec.color)
    children.push(child)
  }

  process.stdout.write(
    `${pc.green('✓')} Started server on ${pc.cyan(`:${port}`)} and Studio on ${pc.magenta(':5173')}. Ctrl+C to stop.\n`,
  )

  const shutdown = (signal: NodeJS.Signals): void => {
    process.stdout.write(`\n${pc.dim(`Received ${signal}, stopping...`)}\n`)
    for (const child of children) child.kill(signal)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Resolve when all children exit. Exit code = first nonzero child code.
  const exits = await Promise.all(children.map(child => new Promise<number>((resolveExit) => {
    child.on('exit', code => resolveExit(code ?? 0))
  })))
  const firstFailure = exits.find(code => code !== 0)
  if (firstFailure !== undefined)
    process.exit(firstFailure)
}

function pipeWithPrefix(child: ChildProcess, tag: string, color: (s: string) => string): void {
  const prefix = color(`[${tag}]`)
  const wire = (stream: NodeJS.ReadableStream | null, sink: NodeJS.WriteStream): void => {
    if (!stream)
      return
    stream.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      for (const line of text.split('\n')) {
        if (line.length > 0)
          sink.write(`${prefix} ${line}\n`)
      }
    })
  }
  wire(child.stdout, process.stdout)
  wire(child.stderr, process.stderr)
}
