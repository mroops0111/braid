import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

export interface MockSpawnScript {
  readonly stdoutLines: readonly string[]
  readonly exitCode?: number
  /** Keep the process alive after the scripted lines, until `endAll` fires. */
  readonly hold?: boolean
}

export interface MockSpawnRecord {
  readonly command: string
  readonly args: readonly string[]
  readonly options: SpawnOptions
}

export function createMockSpawn(scripts: readonly MockSpawnScript[]): {
  spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  invocations: MockSpawnRecord[]
  endAll: () => void
} {
  const invocations: MockSpawnRecord[] = []
  const held: Array<() => void> = []
  let index = 0

  const spawn = (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    invocations.push({ command, args: [...args], options })
    const script = scripts[index] ?? { stdoutLines: [], exitCode: 0 }
    index += 1
    const { child, end } = createFakeProcess(script)
    if (script.hold)
      held.push(end)
    return child
  }

  return {
    spawn,
    invocations,
    endAll: () => {
      for (const end of held.splice(0))
        end()
    },
  }
}

function createFakeProcess(script: MockSpawnScript): { child: ChildProcess, end: () => void } {
  const stdout = new Readable({ read() {} })
  const stderr = new Readable({ read() {} })
  const fake = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    kill: () => true,
  })

  stdout.on('end', () => fake.emit('close', script.exitCode ?? 0))

  const end = (): void => {
    stdout.push(null)
    stderr.push(null)
  }

  setImmediate(() => {
    for (const line of script.stdoutLines) {
      stdout.push(`${line}\n`)
    }
    if (!script.hold)
      end()
  })

  return { child: fake as unknown as ChildProcess, end }
}
