import type { Workspace } from '@telos/core'
import type { McpServerConfig } from '@telos/schema'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface McpConfigFile {
  readonly mcpServers: Readonly<Record<string, McpServerEntry>>
}

interface McpStdioEntry {
  readonly command: string
  readonly args: string[]
  readonly env: Record<string, string>
}

interface McpSseEntry {
  readonly type: 'sse'
  readonly url: string
  readonly headers?: Record<string, string>
}

interface McpHttpEntry {
  readonly type: 'http'
  readonly url: string
  readonly headers?: Record<string, string>
}

type McpServerEntry = McpStdioEntry | McpSseEntry | McpHttpEntry

export function buildMcpConfig(workspace: Workspace): McpConfigFile {
  const entries: Record<string, McpServerEntry> = {}
  for (const server of workspace.mcpServers) {
    entries[server.id] = toEntry(server)
  }
  return { mcpServers: entries }
}

export async function writeMcpConfigFile(workspace: Workspace, targetDir: string): Promise<string> {
  const config = buildMcpConfig(workspace)
  const targetPath = join(targetDir, `.telos-mcp-${workspace.id}.json`)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  return targetPath
}

function toEntry(server: McpServerConfig): McpServerEntry {
  switch (server.transport) {
    case 'stdio':
      return {
        command: server.command,
        args: [...server.args],
        env: { ...server.env },
      }
    case 'sse':
    case 'http':
      return {
        type: server.transport,
        url: server.url,
        ...(server.headers ? { headers: { ...server.headers } } : {}),
      }
    default: {
      const exhaustive: never = server
      throw new Error(`Unhandled MCP transport: ${JSON.stringify(exhaustive)}`)
    }
  }
}
