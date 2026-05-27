import type { Workspace } from '@braidhq/core'
import type { McpServerConfig } from '@braidhq/schema'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'

export interface McpConfigFile {
  readonly mcpServers: Readonly<Record<string, McpServerEntry>>
}

/**
 * Shape claude expects in `--mcp-config <file>`.
 *
 * The Streamable HTTP transport is `type: 'http'` (the claude CLI's
 * legacy name; predates the rename in the MCP 2025-06-18 spec). We
 * use the new name in PRODUCT.md to match the spec and emit the
 * legacy name here so claude understands.
 */
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

export interface BuildMcpConfigOptions {
  /**
   * Extra MCP server entries injected on top of the workspace's own
   * `mcpServers`. Used to wire the built-in `braid-core` gateway —
   * see `SubprocessSkillRunner`. Workspace entries with the same id
   * take precedence (so a workspace can override a built-in).
   */
  extraServers?: readonly McpServerConfig[]
}

export function buildMcpConfig(workspace: Workspace, options: BuildMcpConfigOptions = {}): McpConfigFile {
  const entries: Record<string, McpServerEntry> = {}
  for (const server of options.extraServers ?? []) {
    entries[server.id] = toEntry(server)
  }
  for (const server of workspace.mcpServers) {
    entries[server.id] = toEntry(server)
  }
  return { mcpServers: entries }
}

export async function writeMcpConfigFile(
  workspace: Workspace,
  targetDir: string,
  options: BuildMcpConfigOptions = {},
): Promise<string> {
  const config = buildMcpConfig(workspace, options)
  const targetPath = join(targetDir, `.braid-mcp-${workspace.id}.json`)
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

/**
 * Replace `${VAR}` references in header / env values with the matching
 * parent-process env var. Throws if a referenced var is missing so the
 * user gets a clear error at config-write time rather than a confusing
 * 401 from the MCP server or a silently-misconfigured subprocess.
 */
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
