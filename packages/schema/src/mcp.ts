import { z } from 'zod'

export const McpServerId = z.string().min(1).brand<'McpServerId'>()
export type McpServerId = z.infer<typeof McpServerId>

export const McpTransport = z.enum(['stdio', 'sse', 'http'])
export type McpTransport = z.infer<typeof McpTransport>

export const McpStdioServerConfig = z.object({
  id: McpServerId,
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
})
export type McpStdioServerConfig = z.infer<typeof McpStdioServerConfig>

export const McpSseServerConfig = z.object({
  id: McpServerId,
  transport: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
})
export type McpSseServerConfig = z.infer<typeof McpSseServerConfig>

export const McpHttpServerConfig = z.object({
  id: McpServerId,
  transport: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
})
export type McpHttpServerConfig = z.infer<typeof McpHttpServerConfig>

export const McpServerConfig = z.discriminatedUnion('transport', [
  McpStdioServerConfig,
  McpSseServerConfig,
  McpHttpServerConfig,
])
export type McpServerConfig = z.infer<typeof McpServerConfig>
