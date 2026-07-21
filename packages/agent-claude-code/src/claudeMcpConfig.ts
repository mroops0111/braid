import type { McpServerConfig } from '@braidhq/schema'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'

// Shape claude expects in `--mcp-config <file>`.
// The Streamable HTTP transport is `type: 'http'`,
// the claude CLI's legacy name that predates the MCP 2025-06-18 spec rename.
// PRODUCT.md uses the new name to match the spec,
// this emits the legacy name so claude understands.
interface McpStreamableHttpEntry {
  readonly type: 'http'
  readonly url: string
  readonly headers?: Record<string, string>
}

interface McpStdioEntry {
  readonly type: 'stdio'
  readonly command: string
  readonly args?: readonly string[]
  readonly env?: Record<string, string>
}

type McpServerEntry = McpStreamableHttpEntry | McpStdioEntry

export interface ClaudeMcpConfig {
  readonly mcpServers: Readonly<Record<string, McpServerEntry>>
}

// Later entries win on id, so a workspace server overrides a built-in of the same id.
export function buildClaudeMcpConfig(servers: readonly McpServerConfig[]): ClaudeMcpConfig {
  const entries: Record<string, McpServerEntry> = {}
  for (const server of servers)
    entries[server.id] = toEntry(server)
  return { mcpServers: entries }
}

// Write the config claude reads and return its path.
export async function writeClaudeMcpConfig(
  sessionDir: string,
  workspaceId: string,
  servers: readonly McpServerConfig[],
): Promise<string> {
  const config = buildClaudeMcpConfig(servers)
  const targetPath = join(sessionDir, `.braid-mcp-${workspaceId}.json`)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  return targetPath
}

function toEntry(server: McpServerConfig): McpServerEntry {
  if (server.transport === 'stdio') {
    return {
      type: 'stdio',
      command: server.command,
      ...(server.args ? { args: [...server.args] } : {}),
      ...(server.env ? { env: resolveEnv(server.env) } : {}),
    }
  }
  return {
    type: 'http',
    url: server.url,
    ...(server.headers ? { headers: resolveEnv(server.headers) } : {}),
  }
}

// Replace `${VAR}` references in header and env values with the parent-process env var.
// Throws if a referenced var is missing,
// so the user gets a clear error at config-write time rather than a confusing 401
// from the MCP server or a silently-misconfigured subprocess.
function resolveEnv(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    out[name] = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, varName: string) => {
      const resolved = process.env[varName]
      if (resolved === undefined) {
        throw new Error(`MCP entry "${name}": environment variable "${varName}" is not set`)
      }
      return resolved
    })
  }
  return out
}
