import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

export interface MockSpawnScript {
  readonly stdoutLines: readonly string[]
  readonly exitCode?: number
}

export interface MockSpawnRecord {
  readonly command: string
  readonly args: readonly string[]
  readonly options: SpawnOptions
}

export function createMockSpawn(scripts: readonly MockSpawnScript[]): {
  spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  invocations: MockSpawnRecord[]
} {
  const invocations: MockSpawnRecord[] = []
  let index = 0

  const spawn = (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    invocations.push({ command, args: [...args], options })
    const script = scripts[index] ?? { stdoutLines: [], exitCode: 0 }
    index += 1
    return createFakeProcess(script)
  }

  return { spawn, invocations }
}

function createFakeProcess(script: MockSpawnScript): ChildProcess {
  const stdout = new Readable({ read() {} })
  const stderr = new Readable({ read() {} })
  const fake = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    kill: () => true,
  })

  stdout.on('end', () => fake.emit('close', script.exitCode ?? 0))

  setImmediate(() => {
    for (const line of script.stdoutLines) {
      stdout.push(`${line}\n`)
    }
    stdout.push(null)
    stderr.push(null)
  })

  return fake as unknown as ChildProcess
}
