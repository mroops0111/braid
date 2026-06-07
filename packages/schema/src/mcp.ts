import { z } from 'zod'

export const McpServerId = z.string().min(1).brand<'McpServerId'>()
export type McpServerId = z.infer<typeof McpServerId>

/**
 * MCP transport kind.
 *
 * - `streamable-http`: the modern Streamable HTTP transport (MCP spec
 *   ≥ 2025-06-18). Used for workspace-declared third-party MCP
 *   servers (Redmine / Notion / Linear / …) that already run somewhere
 *   accessible by URL.
 * - `stdio`: claude spawns the server as a child process and
 *   communicates over stdin / stdout. Used for the built-in
 *   `braid-core` gateway (`uvx openapi-mcp-gateway --transport stdio`)
 *   so the gateway lifecycle tracks the skill run without needing a
 *   long-running HTTP server.
 *
 * Schema-level both are first-class; the workspace can declare either
 * shape in its `mcpServers` list, and the skill runner produces the
 * matching claude-cli mcp-config entry.
 */
export const McpTransport = z.enum(['streamable-http', 'stdio'])
export type McpTransport = z.infer<typeof McpTransport>

export const McpStreamableHttpServerConfig = z.object({
  id: McpServerId,
  transport: z.literal('streamable-http'),
  /** Single MCP endpoint URL (handles POST + GET, per spec §2.2). */
  url: z.string().url(),
  /**
   * Request headers. Values may reference environment variables via
   * `${VAR}` interpolation so secrets stay out of `PRODUCT.md`. The
   * runner that builds the MCP config file resolves them at write time.
   */
  headers: z.record(z.string()).optional(),
  /**
   * Free-form markdown describing what this MCP serves. Read by skills
   * via PRODUCT.md so the agent knows when to query which MCP.
   */
  description: z.string().optional(),
})
export type McpStreamableHttpServerConfig = z.infer<typeof McpStreamableHttpServerConfig>

export const McpStdioServerConfig = z.object({
  id: McpServerId,
  transport: z.literal('stdio'),
  /**
   * Executable to spawn. Resolved against PATH; if a workspace wants
   * to pin a specific binary (e.g. for reproducibility), pass an
   * absolute path here. For the built-in braid-core gateway this is
   * `uvx`.
   */
  command: z.string().min(1),
  /** CLI args passed to the spawned process. */
  args: z.array(z.string()).optional(),
  /**
   * Environment variables passed into the spawned process. Values
   * support `${VAR}` interpolation against the parent process env,
   * same rule as `headers` on the HTTP transport.
   */
  env: z.record(z.string()).optional(),
  description: z.string().optional(),
})
export type McpStdioServerConfig = z.infer<typeof McpStdioServerConfig>

export const McpServerConfig = z.discriminatedUnion('transport', [
  McpStreamableHttpServerConfig,
  McpStdioServerConfig,
])
export type McpServerConfig = z.infer<typeof McpServerConfig>
