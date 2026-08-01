import { z } from 'zod'

export const McpServerId = z.string().min(1).brand<'McpServerId'>()
export type McpServerId = z.infer<typeof McpServerId>

/**
 * streamable-http: remote MCP servers reachable by URL (third-party). stdio: a child process,
 * used for the braid-core gateway to track the skill run.
 */
export const McpTransport = z.enum(['streamable-http', 'stdio'])
export type McpTransport = z.infer<typeof McpTransport>

// Identity and intent shared by every transport.
// The connection mechanics live on each variant below.
const McpServerBase = z.object({
  id: McpServerId,
  // Human-authored in Studio, read by skills so the agent knows when to query this MCP.
  description: z.string().optional(),
})

export const McpStreamableHttpServerConfig = McpServerBase.extend({
  transport: z.literal('streamable-http'),
  url: z.string().url(),
  // ${VAR} interpolation keeps secrets out of PRODUCT.md, resolved at write time.
  headers: z.record(z.string()).optional(),
})
export type McpStreamableHttpServerConfig = z.infer<typeof McpStreamableHttpServerConfig>

export const McpStdioServerConfig = McpServerBase.extend({
  transport: z.literal('stdio'),
  // Resolved against PATH, or an absolute path to pin a binary. braid-core uses uvx.
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  // ${VAR} interpolation against the parent env, same as headers.
  env: z.record(z.string()).optional(),
})
export type McpStdioServerConfig = z.infer<typeof McpStdioServerConfig>

export const McpServerConfig = z.discriminatedUnion('transport', [
  McpStreamableHttpServerConfig,
  McpStdioServerConfig,
])
export type McpServerConfig = z.infer<typeof McpServerConfig>
