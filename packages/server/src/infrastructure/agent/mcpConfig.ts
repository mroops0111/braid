import type { Workspace } from '@braidhq/core'
import type { McpServerConfig } from '@braidhq/schema'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'

export interface McpConfigFile {
  readonly mcpServers: Readonly<Record<string, McpServerEntry>>
}

/**
 * Shape claude expects in `--mcp-config <file>`. Mirrors the spec's
 * Streamable HTTP transport: a single endpoint URL with optional headers.
 */
interface McpStreamableHttpEntry {
  readonly type: 'http'
  readonly url: string
  readonly headers?: Record<string, string>
}

type McpServerEntry = McpStreamableHttpEntry

export function buildMcpConfig(workspace: Workspace): McpConfigFile {
  const entries: Record<string, McpServerEntry> = {}
  for (const server of workspace.mcpServers) {
    entries[server.id] = toEntry(server)
  }
  return { mcpServers: entries }
}

export async function writeMcpConfigFile(workspace: Workspace, targetDir: string): Promise<string> {
  const config = buildMcpConfig(workspace)
  const targetPath = join(targetDir, `.braid-mcp-${workspace.id}.json`)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  return targetPath
}

function toEntry(server: McpServerConfig): McpServerEntry {
  // `type: 'http'` is what the claude CLI's mcp-config schema currently
  // names the Streamable HTTP transport (it predates the rename in the MCP
  // 2025-06-18 spec). We use the new name in PRODUCT.md to match the spec;
  // we emit the legacy name here so claude understands.
  return {
    type: 'http',
    url: server.url,
    ...(server.headers ? { headers: resolveHeaders(server.headers) } : {}),
  }
}

/**
 * Replace `${VAR}` references in header values with the matching env var.
 * Throws if a referenced var is missing so the user gets a clear error at
 * config-write time rather than a confusing 401 from the MCP server.
 */
function resolveHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_match, varName: string) => {
      const resolved = process.env[varName]
      if (resolved === undefined) {
        throw new Error(`MCP header "${name}": environment variable "${varName}" is not set`)
      }
      return resolved
    })
  }
  return out
}
