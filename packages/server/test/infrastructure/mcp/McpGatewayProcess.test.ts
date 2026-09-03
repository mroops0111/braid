// The `${...}` literals below are the assertion, not an interpolation.
// They are what the gateway resolves against its env at startup.
/* eslint-disable no-template-curly-in-string */
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { buildMcpGatewayConfig } from '../../../src/infrastructure/mcp/gatewayConfig.js'
import { McpGatewayProcess } from '../../../src/infrastructure/mcp/McpGatewayProcess.js'

const config = buildMcpGatewayConfig({
  host: '0.0.0.0',
  port: 4322,
  publicUrl: 'https://mcp.example.com',
  specUrl: 'http://localhost:4321/openapi.json',
  baseUrl: 'http://localhost:4321',
  issuer: 'https://as.example.com',
  audience: 'https://braid.example.com',
  clientIdRef: '${ID}',
  clientSecretRef: '${SECRET}',
})

// Carries the `oidc` extra, which is what token_exchange verification needs.
const PACKAGE = 'openapi-mcp-gateway[oidc]'

interface Invocation {
  command: string
  args: readonly string[]
}

/**
 * Spawns children that exit on their own until `liveFromInvocation`,
 * so the supervisor's restart loop runs a bounded number of times,
 * and the last child stays up for `stop()` to kill.
 */
function createSpawn(liveFromInvocation: number): {
  spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  invocations: Invocation[]
} {
  const invocations: Invocation[] = []
  const spawn = (command: string, args: readonly string[]): ChildProcess => {
    invocations.push({ command, args: [...args] })
    const child = Object.assign(new EventEmitter(), {
      kill: () => {
        child.emit('exit', null, 'SIGTERM')
        return true
      },
    })
    if (invocations.length < liveFromInvocation)
      setImmediate(() => child.emit('exit', 1, null))
    return child as unknown as ChildProcess
  }
  return { spawn, invocations }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate())
      return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('condition never held')
}

/** Lets a pending restart land, so absence is something the test can see. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1)
    await new Promise(resolve => setImmediate(resolve))
}

async function withConfigPath<T>(run: (configPath: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'braid-mcp-'))
  return await run(join(directory, 'mcp-gateway.yaml'))
}

describe('McpGatewayProcess', () => {
  it('writes the config, then runs the gateway against it', async () => {
    await withConfigPath(async (configPath) => {
      const { spawn, invocations } = createSpawn(1)
      const gateway = new McpGatewayProcess({ uvxBin: 'uvx', configPath, config, gatewayPackage: PACKAGE, spawn, delay: async () => {} })
      await gateway.start()
      await until(() => invocations.length === 1)
      await gateway.stop()

      expect(invocations[0]).toEqual({
        command: 'uvx',
        // The `oidc` extra is what makes token_exchange work at all.
        args: ['--from', PACKAGE, 'openapi-mcp-gateway', '--config', configPath],
      })
      const written = parse(await readFile(configPath, 'utf8'))
      expect(written.servers[0].policy.marked_only).toBe(true)
      expect(written.transport).toBe('streamable-http')
      // Written as a reference the gateway resolves from the env it inherits,
      // so the file on disk is readable without being a secret.
      expect(written.servers[0].auth.upstream.client_secret).toBe('${SECRET}')
    })
  })

  it('restarts the gateway when it exits on its own', async () => {
    await withConfigPath(async (configPath) => {
      const { spawn, invocations } = createSpawn(3)
      const delays: number[] = []
      const gateway = new McpGatewayProcess({
        uvxBin: 'uvx',
        configPath,
        config,
        gatewayPackage: PACKAGE,
        spawn,
        delay: async (milliseconds) => { delays.push(milliseconds) },
        log: () => {},
      })
      await gateway.start()
      await until(() => invocations.length === 3)
      await gateway.stop()

      expect(invocations).toHaveLength(3)
      // Backing off, rather than spinning the CPU on a config mistake,
      // such as a gateway that cannot reach its authorization server.
      expect(delays).toEqual([1000, 2000])
    })
  })

  it('stays down once stopped', async () => {
    await withConfigPath(async (configPath) => {
      const { spawn, invocations } = createSpawn(1)
      const gateway = new McpGatewayProcess({ uvxBin: 'uvx', configPath, config, gatewayPackage: PACKAGE, spawn, delay: async () => {}, log: () => {} })
      await gateway.start()
      await until(() => invocations.length === 1)
      await gateway.stop()
      await settle()
      expect(invocations).toHaveLength(1)
    })
  })

  it('retries when the binary cannot be spawned at all', async () => {
    await withConfigPath(async (configPath) => {
      const invocations: Invocation[] = []
      const spawn = (command: string, args: readonly string[]): ChildProcess => {
        invocations.push({ command, args: [...args] })
        const child = Object.assign(new EventEmitter(), {
          kill: () => {
            child.emit('exit', null, 'SIGTERM')
            return true
          },
        })
        if (invocations.length < 2)
          setImmediate(() => child.emit('error', new Error('ENOENT')))
        return child as unknown as ChildProcess
      }
      const messages: string[] = []
      const gateway = new McpGatewayProcess({
        uvxBin: 'uvx',
        configPath,
        config,
        gatewayPackage: PACKAGE,
        spawn,
        delay: async () => {},
        log: message => messages.push(message),
      })
      await gateway.start()
      await until(() => invocations.length === 2)
      // A missing binary reads the same as a crash,
      // so the operator gets the reason and the config path, not silence.
      expect(messages[0]).toContain('ENOENT')
      expect(messages[0]).toContain(configPath)
      await gateway.stop()
    })
  })
})
