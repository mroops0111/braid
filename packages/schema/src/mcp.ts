import { z } from 'zod'

export const McpServerId = z.string().min(1).brand<'McpServerId'>()
export type McpServerId = z.infer<typeof McpServerId>

/**
 * MCP transport kind. We support the modern Streamable HTTP transport
 * (MCP spec ≥ 2025-06-18). Stdio and the deprecated HTTP+SSE transports
 * are out of scope for v0.1: workspaces talk to remote MCP servers via
 * a single HTTP endpoint with optional SSE upgrades, which fits the
 * "user pastes a server URL" UX cleanly.
 */
export const McpTransport = z.enum(['streamable-http'])
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
})
export type McpStreamableHttpServerConfig = z.infer<typeof McpStreamableHttpServerConfig>

export const McpServerConfig = z.discriminatedUnion('transport', [
  McpStreamableHttpServerConfig,
])
export type McpServerConfig = z.infer<typeof McpServerConfig>
